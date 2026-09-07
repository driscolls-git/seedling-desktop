
/**
 * Printed Plate Index label — a two-letter BerryCode prefix followed by the
 * zero-padded plate index, e.g. plate 322 for blueberry renders as `BU0322`.
 *
 * Requested by Evan 2026-08-27 / 08-31.  He originally asked for the
 * T_GHTraysCreation.Plate_Index column itself to change from int to varchar.
 * We deliberately did NOT do that: the column is read by the separate
 * Seedling Tracker-Flow mobile app over the same GHSeed database (see
 * routes/plate-collection.ts there, which does Number()/isNaN validation on it
 * and would start returning 400s), so an int → varchar change is a breaking
 * cross-application schema change requiring a coordinated release.
 *
 * Instead the label is DERIVED at read time.  The stored value stays an int,
 * every existing consumer keeps working, the 0001-9999 sequence is just the
 * existing per-berry counter, and nothing already printed on a physical label
 * has to be rewritten.
 */

/**
 * Build a SQL expression yielding the label, or NULL when there is no index.
 *
 * @param plateIndexCol int column/expression holding the plate index
 * @param berryNameCol  column holding the berry NAME (M_BerryID.BerryType),
 *                      which is what the vw_GH_* views expose rather than the code
 *
 * Indexes above 9999 render in full rather than being silently truncated by
 * the padding — a wrong label is far worse than a long one.
 */
export function plateLabelExpr(plateIndexCol: string, berryNameCol: string): string {
  return `CASE
      WHEN ${plateIndexCol} IS NULL THEN NULL
      ELSE COALESCE(
             (SELECT TOP 1 bl.BerryCode FROM TPN.dbo.M_BerryID bl WHERE bl.BerryType = ${berryNameCol}),
             ''
           )
           + CASE
               WHEN ${plateIndexCol} > 9999 THEN CAST(${plateIndexCol} AS varchar(10))
               ELSE RIGHT('0000' + CAST(${plateIndexCol} AS varchar(10)), 4)
             END
    END`;
}

/**
 * Accept either a bare number ("322") or a full label ("BU0322") from a filter
 * box and return the numeric index, or null if there is no number in it.
 * Lets users type whatever is printed on the plate.
 */
export function parsePlateIndexInput(raw: unknown): number | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}
