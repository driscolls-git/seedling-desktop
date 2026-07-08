import { queryMany, withTransaction, sql } from "@workspace/db";

/**
 * Trays pipeline — generates genotyping trays for crosses.
 *
 * For every active cross in the current + next pollination year, generate the
 * set of trays needed to lay its TRANSPLANTS_REQUIRED plants onto plates of
 * `Plate_Sample_Num` wells (typically 96), each tray holding `TRAY_SIZE` plants
 * (typically 38 → 3 trays per plate).
 *
 * Tray-code math (deterministic; must never change — labels are printed from it):
 *   trays_per_plate  = ceil(plateSize / traySize)
 *   plate_idx        = floor(well_seq / plateSize) + 1   (within progeny)
 *   well_in_plate    = (well_seq % plateSize) + 1
 *   tray_in_plate    = min(ceil(well_in_plate / traySize), trays_per_plate)
 *   suffix           = (plate_idx - 1) * trays_per_plate + tray_in_plate
 *   Unique_Tray_Code = berryCode + progeny + '.' + zfill(suffix, 2)
 *
 * Additive / immutable model (see TRAY_PIPELINE_REDESIGN.md).  Users print
 * physical labels linked to Unique_Tray_Code + Plate_Index, so existing rows are
 * never renumbered or deleted.  Each run only:
 *   - INSERTs brand-new trays (with a Plate_Index if the progeny is screened,
 *     otherwise NULL);
 *   - UPDATEs Plant_Qty when a tray's plant count grew (top-up);
 *   - back-fills Plate_Index (NULL → value) when a previously non-screened
 *     progeny becomes screened.
 * It never DELETEs, never changes a Unique_Tray_Code, and never overwrites a
 * non-null Plate_Index.
 *
 * Plate_Index is assigned per (Berry_ID, Pollination_Year) continuing from the
 * current MAX in the table — globally unique per berry+year, never reused.
 *
 * Structure: the pure domain logic (buildTraysForSource / planChanges) is kept
 * separate from database I/O, which lives behind the `TrayRepository` seam, so
 * the allocation logic is unit-testable with fakes.
 *
 * Two row classes coexist in T_GHTraysCreation by Created_By: 'GHTrayScript'
 * (the original Python) and 'GHTrayPipeline' (this service).  Both are treated
 * as authoritative and immutable.
 */

const CREATED_BY = "GHTrayPipeline";
let debounceTimer: NodeJS.Timeout | null = null;

// ── Types ──────────────────────────────────────────────────────────────────

export interface SourceRow {
  ghSeedlingMasterId: number;
  progeny: string;
  berryId: number;
  berryCode: string;
  traySize: number;
  transplantsRequired: number;
  pollinationYear: number;
  testLabId: number | null;
  plateSampleNum: number;
  screening: boolean;
}

export interface PreTray {
  uniqueTrayCode: string;
  plantQty: number;
  ghsmFk: number;
  testLabId: number | null;
  pollinationYear: number;
  berryId: number;
  // Plate ordinal *within this progeny* (1, 2, 3, ...).  Used to group trays
  // into physical plates when assigning Plate_Index; never written directly.
  plateWithinProgeny: number;
  screening: boolean;
}

/** An existing row in the target table, as read for the diff. */
export interface ExistingTray {
  uniqueTrayCode: string;
  ghsmFk: number;
  plantQty: number;
  plateIndex: number | null;
  berryId: number;
  pollinationYear: number;
}

/** A brand-new tray to INSERT.  `plateIndex` is null for non-screened progenies. */
export interface InsertTray {
  uniqueTrayCode: string;
  plantQty: number;
  ghsmFk: number;
  testLabId: number | null;
  pollinationYear: number;
  berryId: number;
  plateIndex: number | null;
}

/** A top-up of an existing tray's Plant_Qty (label-safe: code/index unchanged). */
export interface QtyUpdate {
  uniqueTrayCode: string;
  ghsmFk: number;
  plantQty: number;
}

/** A NULL → value Plate_Index back-fill on an existing tray. */
export interface PlateBackfill {
  uniqueTrayCode: string;
  ghsmFk: number;
  plateIndex: number;
}

/** The full set of changes a run will apply. */
export interface TrayPlan {
  inserts: InsertTray[];
  qtyUpdates: QtyUpdate[];
  plateBackfills: PlateBackfill[];
}

// ── Pure domain logic ────────────────────────────────────────────────────────

function buildTraysForSource(s: SourceRow): PreTray[] {
  const total = s.transplantsRequired;
  const plateSize = s.plateSampleNum;
  const traySize = s.traySize;
  if (total <= 0 || plateSize <= 0 || traySize <= 0) return [];

  const traysPerPlate = Math.max(1, Math.ceil(plateSize / traySize));
  const screening = Boolean(s.screening);

  // Bucket plants into trays.  Map key = `${plateIdx}|${suffix}`.
  const buckets = new Map<string, { plateIdx: number; suffix: number; qty: number }>();

  for (let wellSeq = 0; wellSeq < total; wellSeq++) {
    const plateIdx = Math.floor(wellSeq / plateSize) + 1;
    const wellInPlate = (wellSeq % plateSize) + 1;
    const trayInPlate = Math.min(Math.ceil(wellInPlate / traySize), traysPerPlate);
    const suffix = (plateIdx - 1) * traysPerPlate + trayInPlate;
    const key = `${plateIdx}|${suffix}`;
    const cur = buckets.get(key);
    if (cur) cur.qty++;
    else buckets.set(key, { plateIdx, suffix, qty: 1 });
  }

  // Sort by plateIdx then suffix for deterministic ordering (matches the
  // Python's groupby + sort_values).
  const sorted = Array.from(buckets.values()).sort(
    (a, b) => a.plateIdx - b.plateIdx || a.suffix - b.suffix,
  );

  return sorted.map((b) => ({
    uniqueTrayCode: `${s.berryCode}${s.progeny}.${String(b.suffix).padStart(2, "0")}`,
    plantQty: b.qty,
    ghsmFk: s.ghSeedlingMasterId,
    testLabId: s.testLabId,
    pollinationYear: s.pollinationYear,
    berryId: s.berryId,
    plateWithinProgeny: b.plateIdx,
    screening,
  }));
}

const trayKey = (code: string, ghsmFk: number) => `${code}|${ghsmFk}`;
const plateKeyOf = (t: {
  berryId: number;
  pollinationYear: number;
  ghsmFk: number;
  plateWithinProgeny: number;
}) => `${t.berryId}|${t.pollinationYear}|${t.ghsmFk}|${t.plateWithinProgeny}`;
const groupKeyOf = (t: { berryId: number; pollinationYear: number }) =>
  `${t.berryId}|${t.pollinationYear}`;

/**
 * Diff every computed tray against the current table state and produce the
 * additive change set.  Never deletes; never changes a Unique_Tray_Code or an
 * existing non-null Plate_Index.
 *
 *   - New tray            → INSERT (Plate_Index if screened, else NULL).
 *   - Existing, qty grew  → UPDATE Plant_Qty (top-up).
 *   - Existing, null idx & now screened → back-fill Plate_Index.
 *
 * Plate_Index is allocated per physical plate (berry, year, progeny, plate),
 * continuing from MAX(existing Plate_Index) for that berry+year.
 */
function planChanges(allTrays: PreTray[], existing: ExistingTray[]): TrayPlan {
  const existingByKey = new Map<string, ExistingTray>();
  for (const e of existing) existingByKey.set(trayKey(e.uniqueTrayCode, e.ghsmFk), e);

  // High-water mark of Plate_Index per (berry, year), from existing rows.
  const maxByGroup = new Map<string, number>();
  for (const e of existing) {
    if (e.plateIndex == null) continue;
    const g = groupKeyOf(e);
    if (e.plateIndex > (maxByGroup.get(g) ?? 0)) maxByGroup.set(g, e.plateIndex);
  }

  // Group computed trays into physical plates.
  const traysByPlate = new Map<string, PreTray[]>();
  for (const t of allTrays) {
    const pk = plateKeyOf(t);
    const arr = traysByPlate.get(pk);
    if (arr) arr.push(t);
    else traysByPlate.set(pk, [t]);
  }

  // A plate's existing Plate_Index = the index of any of its trays that already
  // has one (they all share it).  Immutable if present.
  const plateExistingIndex = new Map<string, number>();
  for (const [pk, trays] of traysByPlate) {
    for (const t of trays) {
      const e = existingByKey.get(trayKey(t.uniqueTrayCode, t.ghsmFk));
      if (e && e.plateIndex != null) {
        plateExistingIndex.set(pk, e.plateIndex);
        break;
      }
    }
  }

  // Plates that need a NEW index: screened, with no existing index yet.
  const needIndex: { plateKey: string; group: string; ghsmFk: number; plateWithinProgeny: number }[] = [];
  for (const [pk, trays] of traysByPlate) {
    if (plateExistingIndex.has(pk)) continue;
    const rep = trays[0];
    if (!rep.screening) continue;
    needIndex.push({
      plateKey: pk,
      group: groupKeyOf(rep),
      ghsmFk: rep.ghsmFk,
      plateWithinProgeny: rep.plateWithinProgeny,
    });
  }

  // Allocate new indexes per group, continuing from MAX, deterministic order.
  const newIndexByPlate = new Map<string, number>();
  const byGroup = new Map<string, typeof needIndex>();
  for (const p of needIndex) {
    const arr = byGroup.get(p.group);
    if (arr) arr.push(p);
    else byGroup.set(p.group, [p]);
  }
  for (const [g, plates] of byGroup) {
    const sorted = [...plates].sort(
      (a, b) => a.ghsmFk - b.ghsmFk || a.plateWithinProgeny - b.plateWithinProgeny,
    );
    let n = maxByGroup.get(g) ?? 0;
    for (const p of sorted) {
      n += 1;
      newIndexByPlate.set(p.plateKey, n);
    }
  }

  const plateIndexOf = (pk: string): number | null =>
    plateExistingIndex.get(pk) ?? newIndexByPlate.get(pk) ?? null;

  const inserts: InsertTray[] = [];
  const qtyUpdates: QtyUpdate[] = [];
  const plateBackfills: PlateBackfill[] = [];

  for (const t of allTrays) {
    const e = existingByKey.get(trayKey(t.uniqueTrayCode, t.ghsmFk));
    const idx = plateIndexOf(plateKeyOf(t));

    if (!e) {
      inserts.push({
        uniqueTrayCode: t.uniqueTrayCode,
        plantQty: t.plantQty,
        ghsmFk: t.ghsmFk,
        testLabId: t.testLabId,
        pollinationYear: t.pollinationYear,
        berryId: t.berryId,
        plateIndex: idx,
      });
      continue;
    }

    // Existing tray — only the two permitted mutations.
    if (t.plantQty > e.plantQty) {
      qtyUpdates.push({
        uniqueTrayCode: t.uniqueTrayCode,
        ghsmFk: t.ghsmFk,
        plantQty: t.plantQty,
      });
    }
    if (e.plateIndex == null && idx != null) {
      plateBackfills.push({
        uniqueTrayCode: t.uniqueTrayCode,
        ghsmFk: t.ghsmFk,
        plateIndex: idx,
      });
    }
  }

  return { inserts, qtyUpdates, plateBackfills };
}

// ── Repository (database I/O seam) ────────────────────────────────────────────

export interface TrayRepository {
  /** Load eligible source crosses (screened and not) for the two years. */
  fetchSourceRows(currentYear: number, nextYear: number): Promise<SourceRow[]>;
  /** Read the current target rows for the two years (used by the read-only preview). */
  fetchExisting(currentYear: number, nextYear: number): Promise<ExistingTray[]>;
  /**
   * In a single transaction: read the current rows for the two years, hand them
   * to `plan`, and apply the resulting inserts / qty top-ups / Plate_Index
   * back-fills.  No deletes.  Returns the applied plan.
   */
  apply(args: {
    currentYear: number;
    nextYear: number;
    createdBy: string;
    plan: (reads: { existing: ExistingTray[] }) => TrayPlan;
  }): Promise<TrayPlan>;
}

// Shared SELECT for the current target rows — used both inside apply()'s
// transaction and by fetchExisting() for the read-only preview.
const EXISTING_SELECT = `SELECT Unique_Tray_Code AS uniqueTrayCode, ghsm_FK AS ghsmFk,
        Plant_Qty AS plantQty, Plate_Index AS plateIndex,
        Berry_ID AS berryId, Pollination_Year AS pollinationYear
   FROM dbo.T_GHTraysCreation
  WHERE Pollination_Year IN (@cur, @next)`;

class SqlTrayRepository implements TrayRepository {
  async fetchSourceRows(currentYear: number, nextYear: number): Promise<SourceRow[]> {
    return queryMany<SourceRow>(
      `SELECT m.GHSeedlingMaster_ID AS ghSeedlingMasterId,
              m.PROGENY AS progeny,
              m.Berry_ID AS berryId,
              b.BerryCode AS berryCode,
              m.TRAY_SIZE AS traySize,
              m.TRANSPLANTS_REQUIRED AS transplantsRequired,
              m.Pollination_Year AS pollinationYear,
              m.Testing_Lab_1_FK AS testLabId,
              COALESCE(l.Plate_Sample_Num, 96) AS plateSampleNum,
              COALESCE(m.SCREENING, 0) AS screening
         FROM dbo.M_GHSeedlingMaster m
         INNER JOIN TPN.dbo.M_BerryID b ON b.PK_BerryID = m.Berry_ID
         LEFT JOIN dbo.M_GHLabs l ON l.GHLab_ID = m.Testing_Lab_1_FK
        WHERE m.ACTIVE = 1
          AND m.Pollination_Year IN (@cur, @next)
          AND m.TRAY_SIZE IS NOT NULL
          AND m.TRANSPLANTS_REQUIRED IS NOT NULL
          AND m.Berry_ID IS NOT NULL`,
      // NOTE: no Testing_Lab_1_FK filter — non-screened progenies have no
      // testing lab, but still need tray codes (Test_Lab_ID NULL, plate size
      // defaults to 96 via the COALESCE above, Plate_Index stays NULL).
      { cur: currentYear, next: nextYear },
    );
  }

  async fetchExisting(currentYear: number, nextYear: number): Promise<ExistingTray[]> {
    return queryMany<ExistingTray>(EXISTING_SELECT, { cur: currentYear, next: nextYear });
  }

  async apply(args: {
    currentYear: number;
    nextYear: number;
    createdBy: string;
    plan: (reads: { existing: ExistingTray[] }) => TrayPlan;
  }): Promise<TrayPlan> {
    const { currentYear, nextYear, createdBy, plan } = args;
    return withTransaction(async (tx) => {
      const existing = await tx.queryMany<ExistingTray>(EXISTING_SELECT, {
        cur: currentYear,
        next: nextYear,
      });

      const result = plan({ existing });

      // INSERT new trays.  Plate_Index is typed explicitly so a NULL (non-
      // screened) inserts as a typed NULL into the int column.
      for (const t of result.inserts) {
        await tx.execute(
          `INSERT INTO dbo.T_GHTraysCreation
             (Unique_Tray_Code, Plant_Qty, ghsm_FK, Test_Lab_ID,
              Pollination_Year, Plate_Index, Berry_ID,
              Created_By, Created_DateTime, Modified_By, Modified_DateTime)
           VALUES (@code, @qty, @ghsm, @lab,
                   @py, @plate, @berry,
                   @user, GETDATE(), @user, GETDATE())`,
          {
            code: t.uniqueTrayCode, qty: t.plantQty,
            ghsm: t.ghsmFk, lab: [sql.Int, t.testLabId],
            py: t.pollinationYear, plate: [sql.Int, t.plateIndex], berry: t.berryId,
            user: createdBy,
          },
        );
      }

      // UPDATE Plant_Qty (top-up) — never touches the code or Plate_Index.
      for (const u of result.qtyUpdates) {
        await tx.execute(
          `UPDATE dbo.T_GHTraysCreation
              SET Plant_Qty = @qty, Modified_By = @user, Modified_DateTime = GETDATE()
            WHERE Unique_Tray_Code = @code AND ghsm_FK = @ghsm`,
          { qty: u.plantQty, code: u.uniqueTrayCode, ghsm: u.ghsmFk, user: createdBy },
        );
      }

      // Back-fill Plate_Index (NULL → value only; the WHERE guard makes it
      // impossible to overwrite a non-null index).
      for (const bf of result.plateBackfills) {
        await tx.execute(
          `UPDATE dbo.T_GHTraysCreation
              SET Plate_Index = @plate, Modified_By = @user, Modified_DateTime = GETDATE()
            WHERE Unique_Tray_Code = @code AND ghsm_FK = @ghsm AND Plate_Index IS NULL`,
          { plate: bf.plateIndex, code: bf.uniqueTrayCode, ghsm: bf.ghsmFk, user: createdBy },
        );
      }

      return result;
    });
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────

export async function runTrayPipeline(
  repo: TrayRepository = new SqlTrayRepository(),
): Promise<void> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const nextYear = currentYear + 1;

  try {
    const sources = await repo.fetchSourceRows(currentYear, nextYear);
    if (sources.length === 0) {
      console.log("[tray-pipeline] no source crosses — nothing to do");
      return;
    }

    const allTrays: PreTray[] = [];
    for (const s of sources) {
      allTrays.push(...buildTraysForSource(s));
    }
    if (allTrays.length === 0) {
      console.log("[tray-pipeline] no trays computed — nothing to do");
      return;
    }

    const plan = await repo.apply({
      currentYear,
      nextYear,
      createdBy: CREATED_BY,
      plan: ({ existing }) => planChanges(allTrays, existing),
    });

    const { inserts, qtyUpdates, plateBackfills } = plan;
    if (inserts.length === 0 && qtyUpdates.length === 0 && plateBackfills.length === 0) {
      console.log("[tray-pipeline] up to date — no changes");
      return;
    }
    console.log(
      `[tray-pipeline] +${inserts.length} new trays, ${qtyUpdates.length} qty top-ups, ` +
        `${plateBackfills.length} plate-index back-fills (for ${sources.length} crosses)`,
    );
  } catch (err) {
    console.error("[tray-pipeline] error:", err);
  }
}

/**
 * Read-only preview: compute the plan the next run would produce, writing
 * NOTHING. Backs the `preview-trays` script so the change set can be inspected
 * on demand before (or without) a real run.
 */
export async function previewTrayPipeline(
  repo: TrayRepository = new SqlTrayRepository(),
): Promise<{
  sources: number;
  screened: number;
  nonScreened: number;
  computedTrays: number;
  existingRows: number;
  plan: TrayPlan;
}> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const nextYear = currentYear + 1;

  const sources = await repo.fetchSourceRows(currentYear, nextYear);
  const allTrays: PreTray[] = [];
  for (const s of sources) allTrays.push(...buildTraysForSource(s));
  const existing = await repo.fetchExisting(currentYear, nextYear);
  const plan = planChanges(allTrays, existing);

  return {
    sources: sources.length,
    screened: sources.filter((s) => s.screening).length,
    nonScreened: sources.filter((s) => !s.screening).length,
    computedTrays: allTrays.length,
    existingRows: existing.length,
    plan,
  };
}

export function scheduleTrayPipeline(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runTrayPipeline();
  }, 10_000);
}

// Exported for unit testing / one-off backfill scripts.
export const _internals = {
  buildTraysForSource,
  planChanges,
  SqlTrayRepository,
};
