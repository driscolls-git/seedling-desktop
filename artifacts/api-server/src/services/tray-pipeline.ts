import { queryMany, withTransaction, sql } from "@workspace/db";
import { recalcSeedlingMaster } from "./recalc";

/**
 * Trays pipeline — generates genotyping trays for crosses.
 *
 * Triggered on demand from the Transplant page's "Export Tray Codes and Plate
 * Indexes CSV" button (Admin3 only), scoped to a single selected
 * Berry + Team + Pollination_Year.  There are no automatic/event-driven runs.
 *
 * For every eligible cross in the selection, generate the set of trays needed
 * to lay its TRANSPLANTS_REQUIRED plants into trays of `TRAY_SIZE` plants:
 *   - Screened progenies are laid onto plates of `Plate_Sample_Num` wells
 *     (typically 96), each tray holding `TRAY_SIZE` plants (typically 38 → 3
 *     trays per plate), and receive a Plate_Index.
 *   - Non-screened progenies are NOT capped by plate size: they get
 *     ceil(TRANSPLANTS_REQUIRED / TRAY_SIZE) sequential trays and a NULL
 *     Plate_Index.
 *
 * Eligibility (per progeny, evaluated against the current time):
 *   - Seed-acid deadline must have PASSED (vw_GHSeedDesk.Acid_Deadline_Date <=
 *     now).  Until then the seed weight can still change, so we don't commit
 *     tray codes.  A NULL deadline is treated as "not passed" (skipped).
 *   - Deadline passed + Seed_Weight_Inventory > 0  → build/top-up tray codes.
 *   - Deadline passed + Seed_Weight_Inventory = 0  → no trays; the progeny is
 *     cancelled: its six ship-input columns are zeroed and the required-amount
 *     recalc is re-run so required amounts back-calculate to 0.
 *
 * Tray-code math (deterministic; must never change — labels are printed from it):
 *   Screened:
 *     trays_per_plate  = ceil(plateSize / traySize)
 *     plate_idx        = floor(well_seq / plateSize) + 1   (within progeny)
 *     well_in_plate    = (well_seq % plateSize) + 1
 *     tray_in_plate    = min(ceil(well_in_plate / traySize), trays_per_plate)
 *     suffix           = (plate_idx - 1) * trays_per_plate + tray_in_plate
 *   Non-screened:
 *     num_trays        = ceil(total / traySize)
 *     suffix           = 1 .. num_trays  (sequential, no plate cap)
 *   Unique_Tray_Code   = berryCode + progeny + '.' + zfill(suffix, 2)
 *
 * Additive model (see TRAY_PIPELINE_REDESIGN.md).  Users print physical labels
 * linked to Unique_Tray_Code + Plate_Index, so those are immutable — existing
 * rows are never renumbered or deleted.  Each run only:
 *   - INSERTs brand-new trays (with a Plate_Index if the progeny is screened,
 *     otherwise NULL);
 *   - SYNCs Plant_Qty on existing trays of a processed progeny to the newly
 *     computed count — up (top-up) OR down (shrink).  A tray the computation no
 *     longer produces is set to Plant_Qty = 0 (never NULL); the row/code/index
 *     stay in place.  Plant_Qty is safe to mutate because it is not on the label.
 *   - back-fills Plate_Index (NULL → value) when a previously non-screened
 *     progeny becomes screened.
 * It never DELETEs, never changes a Unique_Tray_Code, and never overwrites a
 * non-null Plate_Index.
 *
 * Plate_Index is assigned per (Berry_ID, Pollination_Year) continuing from the
 * current MAX in the table — globally unique per berry+year, never reused.  New
 * indexes are allocated in ascending PROGENY order.
 *
 * Structure: the pure domain logic (buildTraysForSource / classifySources /
 * planChanges) is kept separate from database I/O, which lives behind the
 * `TrayRepository` seam, so the allocation logic is unit-testable with fakes.
 *
 * Two row classes coexist in T_GHTraysCreation by Created_By: 'GHTrayScript'
 * (the original Python) and 'GHTrayPipeline' (this service).  Both are treated
 * as authoritative and immutable.
 */

const CREATED_BY = "GHTrayPipeline";

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
  // Gating inputs from vw_GHSeedDesk.
  acidDeadlineDate: Date | string | null;
  seedWeightInventory: number | null;
}

export interface PreTray {
  uniqueTrayCode: string;
  plantQty: number;
  ghsmFk: number;
  testLabId: number | null;
  pollinationYear: number;
  berryId: number;
  progeny: string;
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

/** A zero-seed progeny to cancel: zero its six ship-input columns. */
export interface ShipZero {
  ghsmFk: number;
}

/** The full set of changes a run will apply. */
export interface TrayPlan {
  inserts: InsertTray[];
  qtyUpdates: QtyUpdate[];
  plateBackfills: PlateBackfill[];
  shipZeros: ShipZero[];
}

/** Summary of what a selection run computed / applied. */
export interface TraySummary {
  berryId: number;
  teamId: number;
  pollinationYear: number;
  sources: number;
  built: number;
  cancelled: number;
  inserts: number;
  qtyUpdates: number;
  plateBackfills: number;
  shipZeros: number;
}

// ── Pure domain logic ────────────────────────────────────────────────────────

const zfill2 = (n: number) => String(n).padStart(2, "0");

function buildTraysForSource(s: SourceRow): PreTray[] {
  const total = s.transplantsRequired;
  const traySize = s.traySize;
  if (total <= 0 || traySize <= 0) return [];
  const screening = Boolean(s.screening);

  // Non-screened progenies are not capped by plate size: lay the plants into
  // ceil(total / traySize) sequential trays, last one holding the remainder.
  if (!screening) {
    const numTrays = Math.ceil(total / traySize);
    const out: PreTray[] = [];
    for (let i = 1; i <= numTrays; i++) {
      const qty = Math.min(traySize, total - (i - 1) * traySize);
      out.push({
        uniqueTrayCode: `${s.berryCode}${s.progeny}.${zfill2(i)}`,
        plantQty: qty,
        ghsmFk: s.ghSeedlingMasterId,
        testLabId: s.testLabId,
        pollinationYear: s.pollinationYear,
        berryId: s.berryId,
        progeny: s.progeny,
        plateWithinProgeny: i,
        screening: false,
      });
    }
    return out;
  }

  // Screened: plate-capped math.
  const plateSize = s.plateSampleNum;
  if (plateSize <= 0) return [];
  const traysPerPlate = Math.max(1, Math.ceil(plateSize / traySize));

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
    uniqueTrayCode: `${s.berryCode}${s.progeny}.${zfill2(b.suffix)}`,
    plantQty: b.qty,
    ghsmFk: s.ghSeedlingMasterId,
    testLabId: s.testLabId,
    pollinationYear: s.pollinationYear,
    berryId: s.berryId,
    progeny: s.progeny,
    plateWithinProgeny: b.plateIdx,
    screening: true,
  }));
}

/**
 * Split the selection's source rows into the ones that should get tray codes
 * built (deadline passed, seed weight > 0) and the ones to cancel (deadline
 * passed, seed weight = 0).  Progenies whose seed-acid deadline has NOT passed
 * (or is NULL/unparseable) are dropped entirely — not yet eligible.
 */
function classifySources(
  sources: SourceRow[],
  now: Date,
): { toBuild: SourceRow[]; toCancel: SourceRow[] } {
  const toBuild: SourceRow[] = [];
  const toCancel: SourceRow[] = [];
  const nowMs = now.getTime();
  for (const s of sources) {
    const raw = s.acidDeadlineDate;
    if (raw == null) continue;
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getTime() > nowMs) continue; // deadline not yet passed
    const seed = s.seedWeightInventory ?? 0;
    if (seed > 0) toBuild.push(s);
    else toCancel.push(s);
  }
  return { toBuild, toCancel };
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
 *   - New tray                → INSERT (Plate_Index if screened, else NULL).
 *   - Existing, qty differs    → UPDATE Plant_Qty to the computed count (up OR down).
 *   - Existing, no longer computed (progeny processed) → UPDATE Plant_Qty = 0.
 *   - Existing, null idx & now screened → back-fill Plate_Index.
 *
 * Plate_Index is allocated per physical plate (berry, year, progeny, plate),
 * continuing from MAX(existing Plate_Index) for that berry+year, in ascending
 * PROGENY order.
 *
 * `opts.syncGhsmFks` are the progenies actually processed this run (the ones we
 * built trays for); only their orphaned existing trays are zeroed — trays of
 * progenies not in scope are left untouched.
 * `opts.cancelGhsmFks` are zero-seed progenies to cancel — emitted as `shipZeros`.
 */
function planChanges(
  allTrays: PreTray[],
  existing: ExistingTray[],
  opts: { syncGhsmFks?: number[]; cancelGhsmFks?: number[] } = {},
): TrayPlan {
  const { syncGhsmFks = [], cancelGhsmFks = [] } = opts;
  const syncSet = new Set(syncGhsmFks);

  const existingByKey = new Map<string, ExistingTray>();
  for (const e of existing) existingByKey.set(trayKey(e.uniqueTrayCode, e.ghsmFk), e);
  const computedKeys = new Set<string>();
  for (const t of allTrays) computedKeys.add(trayKey(t.uniqueTrayCode, t.ghsmFk));

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
  const needIndex: {
    plateKey: string;
    group: string;
    progeny: string;
    ghsmFk: number;
    plateWithinProgeny: number;
  }[] = [];
  for (const [pk, trays] of traysByPlate) {
    if (plateExistingIndex.has(pk)) continue;
    const rep = trays[0];
    if (!rep.screening) continue;
    needIndex.push({
      plateKey: pk,
      group: groupKeyOf(rep),
      progeny: rep.progeny,
      ghsmFk: rep.ghsmFk,
      plateWithinProgeny: rep.plateWithinProgeny,
    });
  }

  // Allocate new indexes per group, continuing from MAX, in ascending PROGENY
  // order (then plate within progeny, then ghsmFk for a stable tiebreak).
  const newIndexByPlate = new Map<string, number>();
  const byGroup = new Map<string, typeof needIndex>();
  for (const p of needIndex) {
    const arr = byGroup.get(p.group);
    if (arr) arr.push(p);
    else byGroup.set(p.group, [p]);
  }
  for (const [g, plates] of byGroup) {
    const sorted = [...plates].sort(
      (a, b) =>
        a.progeny.localeCompare(b.progeny) ||
        a.plateWithinProgeny - b.plateWithinProgeny ||
        a.ghsmFk - b.ghsmFk,
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

    // Existing tray — sync Plant_Qty to the computed count in either direction
    // (top-up or shrink).  Code and Plate_Index are left untouched.
    if (t.plantQty !== e.plantQty) {
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

  // Zero out orphaned trays: existing rows for a processed progeny that the new
  // computation no longer produces (e.g. required dropped).  The row, code and
  // Plate_Index stay immutable; only Plant_Qty goes to 0 (never NULL).  Scoped
  // to syncGhsmFks so trays of progenies not processed this run aren't touched.
  for (const e of existing) {
    if (!syncSet.has(e.ghsmFk)) continue;
    if (computedKeys.has(trayKey(e.uniqueTrayCode, e.ghsmFk))) continue;
    if (e.plantQty !== 0) {
      qtyUpdates.push({ uniqueTrayCode: e.uniqueTrayCode, ghsmFk: e.ghsmFk, plantQty: 0 });
    }
  }

  const shipZeros: ShipZero[] = cancelGhsmFks.map((ghsmFk) => ({ ghsmFk }));

  return { inserts, qtyUpdates, plateBackfills, shipZeros };
}

// ── Repository (database I/O seam) ────────────────────────────────────────────

export interface TrayRepository {
  /** Load eligible source crosses for the selected berry + team + year. */
  fetchSourceRows(
    berryId: number,
    teamId: number,
    pollinationYear: number,
  ): Promise<SourceRow[]>;
  /** Read the current target rows for the berry + year (used by the read-only preview). */
  fetchExisting(berryId: number, pollinationYear: number): Promise<ExistingTray[]>;
  /**
   * In a single transaction: read the current rows for the berry + year, hand
   * them to `plan`, and apply the resulting inserts / qty top-ups / Plate_Index
   * back-fills / ship-zeros.  No deletes.  Returns the applied plan.
   */
  apply(args: {
    berryId: number;
    pollinationYear: number;
    createdBy: string;
    plan: (reads: { existing: ExistingTray[] }) => TrayPlan;
  }): Promise<TrayPlan>;
}

// Shared SELECT for the current target rows — used both inside apply()'s
// transaction and by fetchExisting() for the read-only preview.  Plate_Index is
// globally unique per (berry, year), so the diff reads the whole berry+year
// (all teams) to get a correct MAX high-water mark.
const EXISTING_SELECT = `SELECT Unique_Tray_Code AS uniqueTrayCode, ghsm_FK AS ghsmFk,
        Plant_Qty AS plantQty, Plate_Index AS plateIndex,
        Berry_ID AS berryId, Pollination_Year AS pollinationYear
   FROM dbo.T_GHTraysCreation
  WHERE Berry_ID = @berry AND Pollination_Year = @py`;

class SqlTrayRepository implements TrayRepository {
  async fetchSourceRows(
    berryId: number,
    teamId: number,
    pollinationYear: number,
  ): Promise<SourceRow[]> {
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
              COALESCE(m.SCREENING, 0) AS screening,
              v.Acid_Deadline_Date AS acidDeadlineDate,
              v.Seed_Weight_Inventory AS seedWeightInventory
         FROM dbo.M_GHSeedlingMaster m
         INNER JOIN TPN.dbo.M_BerryID b ON b.PK_BerryID = m.Berry_ID
         LEFT JOIN dbo.M_GHLabs l ON l.GHLab_ID = m.Testing_Lab_1_FK
         INNER JOIN dbo.vw_GHSeedDesk v ON v.GHSeedlingMaster_ID = m.GHSeedlingMaster_ID
        WHERE m.ACTIVE = 1
          AND m.Berry_ID = @berry
          AND m.Team_ID = @team
          AND m.Pollination_Year = @py
          AND m.TRAY_SIZE IS NOT NULL
          AND m.TRANSPLANTS_REQUIRED IS NOT NULL`,
      // NOTE: no Testing_Lab_1_FK filter — non-screened progenies have no
      // testing lab, but still need tray codes (Test_Lab_ID NULL, plate size
      // defaults to 96 via the COALESCE above, Plate_Index stays NULL).
      { berry: berryId, team: teamId, py: pollinationYear },
    );
  }

  async fetchExisting(berryId: number, pollinationYear: number): Promise<ExistingTray[]> {
    return queryMany<ExistingTray>(EXISTING_SELECT, { berry: berryId, py: pollinationYear });
  }

  async apply(args: {
    berryId: number;
    pollinationYear: number;
    createdBy: string;
    plan: (reads: { existing: ExistingTray[] }) => TrayPlan;
  }): Promise<TrayPlan> {
    const { berryId, pollinationYear, createdBy, plan } = args;
    return withTransaction(async (tx) => {
      const existing = await tx.queryMany<ExistingTray>(EXISTING_SELECT, {
        berry: berryId,
        py: pollinationYear,
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

      // Cancel zero-seed progenies: zero every input to the computed
      // TOTAL_SEEDLING_SHIP_REQUEST_Calc so it (and the back-calculated required
      // amounts) drop to 0.  M_GHSeedlingMaster uses Modified_Date/Modified_By.
      for (const z of result.shipZeros) {
        await tx.execute(
          `UPDATE dbo.M_GHSeedlingMaster
              SET D1_SEEDLING_SHIP_REQUEST = 0,
                  D2_SEEDLING_SHIP_REQUEST = 0,
                  Breeder_Requested_ShipDest1_Adjustments = 0,
                  Breeder_Requested_ShipDest2_Adjustments = 0,
                  D1_Transplant_Adjustment = 0,
                  D2_Transplant_Adjustment = 0,
                  Modified_By = @user, Modified_Date = GETDATE()
            WHERE GHSeedlingMaster_ID = @ghsm`,
          { ghsm: z.ghsmFk, user: createdBy },
        );
      }

      return result;
    });
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Generate tray codes for a single Berry + Team + Pollination_Year selection.
 * Fetches sources, classifies by deadline + seed weight, builds trays for the
 * eligible ones, cancels the zero-seed ones, applies the additive plan in a
 * transaction, then (only if anything was cancelled) re-runs the table-wide
 * required-amount recalc so the zeroed ship quantities propagate.
 */
export async function generateTrayCodesForSelection(
  args: { berryId: number; teamId: number; pollinationYear: number },
  repo: TrayRepository = new SqlTrayRepository(),
  recalc: () => Promise<void> = recalcSeedlingMaster,
  now: Date = new Date(),
): Promise<TraySummary> {
  const { berryId, teamId, pollinationYear } = args;

  const sources = await repo.fetchSourceRows(berryId, teamId, pollinationYear);
  const { toBuild, toCancel } = classifySources(sources, now);

  const allTrays: PreTray[] = [];
  for (const s of toBuild) allTrays.push(...buildTraysForSource(s));
  // Progenies actually processed this run — their orphaned trays get zeroed.
  const syncGhsmFks = toBuild.map((s) => s.ghSeedlingMasterId);
  const cancelGhsmFks = toCancel.map((s) => s.ghSeedlingMasterId);

  const plan = await repo.apply({
    berryId,
    pollinationYear,
    createdBy: CREATED_BY,
    plan: ({ existing }) => planChanges(allTrays, existing, { syncGhsmFks, cancelGhsmFks }),
  });

  // Recalc after the ship-zeroing commit so the proc reads the zeroed values.
  if (plan.shipZeros.length > 0) {
    await recalc();
  }

  const summary: TraySummary = {
    berryId,
    teamId,
    pollinationYear,
    sources: sources.length,
    built: toBuild.length,
    cancelled: toCancel.length,
    inserts: plan.inserts.length,
    qtyUpdates: plan.qtyUpdates.length,
    plateBackfills: plan.plateBackfills.length,
    shipZeros: plan.shipZeros.length,
  };
  console.log(
    `[tray-pipeline] berry=${berryId} team=${teamId} year=${pollinationYear}: ` +
      `${summary.sources} sources → +${summary.inserts} new trays, ` +
      `${summary.qtyUpdates} qty syncs (up/down/zero), ${summary.plateBackfills} plate back-fills, ` +
      `${summary.shipZeros} ship-zeroed (of ${summary.cancelled} zero-seed detected)`,
  );
  return summary;
}

/**
 * Read-only preview: compute the plan a run for this selection would produce,
 * writing NOTHING.  Backs the `preview-trays` script so the change set can be
 * inspected on demand before (or without) a real run.
 */
export async function previewTrayPipeline(
  args: { berryId: number; teamId: number; pollinationYear: number },
  repo: TrayRepository = new SqlTrayRepository(),
  now: Date = new Date(),
): Promise<{
  sources: number;
  built: number;
  cancelled: number;
  computedTrays: number;
  existingRows: number;
  plan: TrayPlan;
}> {
  const { berryId, teamId, pollinationYear } = args;

  const sources = await repo.fetchSourceRows(berryId, teamId, pollinationYear);
  const { toBuild, toCancel } = classifySources(sources, now);
  const allTrays: PreTray[] = [];
  for (const s of toBuild) allTrays.push(...buildTraysForSource(s));
  const existing = await repo.fetchExisting(berryId, pollinationYear);
  const plan = planChanges(allTrays, existing, {
    syncGhsmFks: toBuild.map((s) => s.ghSeedlingMasterId),
    cancelGhsmFks: toCancel.map((s) => s.ghSeedlingMasterId),
  });

  return {
    sources: sources.length,
    built: toBuild.length,
    cancelled: toCancel.length,
    computedTrays: allTrays.length,
    existingRows: existing.length,
    plan,
  };
}

// Exported for unit testing / one-off backfill scripts.
export const _internals = {
  buildTraysForSource,
  classifySources,
  planChanges,
  SqlTrayRepository,
};
