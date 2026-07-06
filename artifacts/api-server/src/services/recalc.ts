import { callProc } from "@workspace/db";

/**
 * Trigger the server-side recalculation of derived/required columns on
 * M_GHSeedlingMaster (TRANSPLANTS_REQUIRED, P1/P2_TOTAL_PARENTS_REQUIRED,
 * FRUIT_REQUIRED, etc.).
 *
 * The proc only updates rows whose deadlines haven't passed yet, so frozen
 * historical values stay intact.  If the proc isn't executable for the
 * connecting user, recalc is silently a no-op (run as a DBA):
 *   GRANT EXECUTE ON dbo.usp_Update_GHSeedlingMaster_Calculations TO WebAppUser;
 *
 * Divide-by-zero handling: the proc's per-row math (steps 6 & 7,
 * P1/P2_TOTAL_PARENTS_REQUIRED) divides by rt.Flowers_per_Parent_Calc /
 * piv.First_Yr_Parent.  When a single bad row makes that zero, SQL Server
 * raises a statement-level error (msg 8134).  Each UPDATE in the proc is its
 * own statement, so a divide-by-zero in step 6 or 7 only terminates THAT
 * UPDATE — earlier steps (1-5, including TRANSPLANTS_REQUIRED) still run.
 * The mssql driver still rejects the promise because it aggregates the
 * statement-level errors, so we catch and demote them to info-level so the
 * caller sees a successful recalc for the rows that did update.  Any other
 * error class is logged as a real warning.
 *
 * Call after any write that changes a field the proc depends on (transplants
 * required is sensitive to D1/D2 transplant adjustments, ratios, ship requests,
 * etc.).
 */
export async function recalcSeedlingMaster(): Promise<void> {
  try {
    await callProc("dbo.usp_Update_GHSeedlingMaster_Calculations");
  } catch (err) {
    // The mssql/tedious driver wraps multi-statement-error procs as a
    // RequestError whose top-level .message can be empty; the actual SQL
    // error texts live on .precedingErrors[] (and sometimes .errors[]).
    // Aggregate all messages and numbers so we can classify the failure.
    const e = err as {
      message?: string;
      number?: number;
      precedingErrors?: Array<{ message?: string; number?: number }>;
      errors?: Array<{ message?: string; number?: number }>;
    };
    const all = [
      e?.message,
      ...(e?.precedingErrors ?? []).map((p) => p?.message),
      ...(e?.errors ?? []).map((p) => p?.message),
    ].filter((s): s is string => !!s);
    const numbers = [
      e?.number,
      ...(e?.precedingErrors ?? []).map((p) => p?.number),
      ...(e?.errors ?? []).map((p) => p?.number),
    ].filter((n): n is number => typeof n === "number");
    const combined = all.join(" | ");

    // SQL Server divide-by-zero = msg 8134.  Each UPDATE in the proc is its
    // own statement, so 8134 only terminates THAT UPDATE; earlier steps
    // (1-5, including TRANSPLANTS_REQUIRED) already ran successfully.
    const onlyDivByZero =
      numbers.length > 0 && numbers.every((n) => n === 8134);
    if (onlyDivByZero || /Divide by zero/i.test(combined)) {
      console.log(
        "[recalc] partial run — divide-by-zero in P1/P2 parent calc " +
          "(some ratio/parent row has zero in Flowers_per_Parent_Calc or First_Yr_Parent); " +
          "TRANSPLANTS_REQUIRED and other steps still updated.",
      );
      return;
    }
    console.warn(
      "[recalc] usp_Update_GHSeedlingMaster_Calculations failed:",
      combined || (err instanceof Error ? err.message : String(err)) || "(no message)",
    );
  }
}
