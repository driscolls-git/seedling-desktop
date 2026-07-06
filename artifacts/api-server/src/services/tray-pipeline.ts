import { queryMany, withTransaction } from "@workspace/db";

/**
 * Trays pipeline — TypeScript port of the original Python
 * `Tray_Code_Generator2.0.py` (saved at C:/tmp/claude/Tray_Code_Generator2.0.py).
 *
 * For every active, screened cross in the current + next pollination year,
 * generate the set of trays needed to genotype its TRANSPLANTS_REQUIRED plants
 * onto plates of `Plate_Sample_Num` wells (typically 96), with each tray
 * holding `TRAY_SIZE` plants (typically 38, so 3 trays per plate).
 *
 * Two row classes coexist in T_GHTraysCreation:
 *   - Created_By = 'GHTrayScript'   ← rows the Python script wrote (correct).
 *   - Created_By = 'GHTrayPipeline' ← rows this service writes.
 *
 * Earlier versions of this service used a per-progeny `plate` counter as
 * Plate_Index and 3-digit suffix padding, which (a) made Plate_Index collide
 * across thousands of progenies (the view vw_GH_MarkerPlateDesk groups by
 * Plate_Index, so Samples_Required ballooned to ~97k for Plate_Index=1) and
 * (b) used a different Unique_Tray_Code format than the script (.006 vs .06)
 * so the anti-join never recognized script rows.  This rewrite mirrors the
 * Python:
 *
 *   trays_per_plate  = ceil(plateSize / traySize)
 *   plate_idx        = floor(well_seq / plateSize) + 1   (within progeny)
 *   well_in_plate    = (well_seq % plateSize) + 1
 *   tray_in_plate    = min(ceil(well_in_plate / traySize), trays_per_plate)
 *   suffix           = (plate_idx - 1) * trays_per_plate + tray_in_plate
 *   Plant_Qty        = wells in that tray
 *   Unique_Tray_Code = berryCode + progeny + '.' + zfill(suffix, 2)
 *
 * Plate_Index is then assigned per (Berry_ID, Pollination_Year) starting from
 * MAX(Plate_Index) + 1 in the table — so it's globally unique per berry+year,
 * matching the script.
 */

const CREATED_BY = "GHTrayPipeline";
let debounceTimer: NodeJS.Timeout | null = null;

interface SourceRow {
  ghSeedlingMasterId: number;
  progeny: string;
  berryId: number;
  berryCode: string;
  traySize: number;
  transplantsRequired: number;
  pollinationYear: number;
  testLabId: number | null;
  plateSampleNum: number;
}

interface PreTray {
  uniqueTrayCode: string;
  plantQty: number;
  ghsmFk: number;
  testLabId: number | null;
  pollinationYear: number;
  berryId: number;
  // Plate ordinal *within this progeny* (1, 2, 3, ...).  Used solely to
  // group trays into physical plates when assigning the global Plate_Index;
  // never written to the DB directly.
  plateWithinProgeny: number;
}

interface InsertTray extends PreTray {
  plateIndex: number;
}

function buildTraysForSource(s: SourceRow): PreTray[] {
  const total = s.transplantsRequired;
  const plateSize = s.plateSampleNum;
  const traySize = s.traySize;
  if (total <= 0 || plateSize <= 0 || traySize <= 0) return [];

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
    uniqueTrayCode: `${s.berryCode}${s.progeny}.${String(b.suffix).padStart(2, "0")}`,
    plantQty: b.qty,
    ghsmFk: s.ghSeedlingMasterId,
    testLabId: s.testLabId,
    pollinationYear: s.pollinationYear,
    berryId: s.berryId,
    plateWithinProgeny: b.plateIdx,
  }));
}

export async function runTrayPipeline(): Promise<void> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const nextYear = currentYear + 1;

  try {
    const sources = await queryMany<SourceRow>(
      `SELECT m.GHSeedlingMaster_ID AS ghSeedlingMasterId,
              m.PROGENY AS progeny,
              m.Berry_ID AS berryId,
              b.BerryCode AS berryCode,
              m.TRAY_SIZE AS traySize,
              m.TRANSPLANTS_REQUIRED AS transplantsRequired,
              m.Pollination_Year AS pollinationYear,
              m.Testing_Lab_1_FK AS testLabId,
              COALESCE(l.Plate_Sample_Num, 96) AS plateSampleNum
         FROM dbo.M_GHSeedlingMaster m
         INNER JOIN TPN.dbo.M_BerryID b ON b.PK_BerryID = m.Berry_ID
         LEFT JOIN dbo.M_GHLabs l ON l.GHLab_ID = m.Testing_Lab_1_FK
        WHERE m.ACTIVE = 1
          AND m.SCREENING = 1
          AND m.Pollination_Year IN (@cur, @next)
          AND m.TRAY_SIZE IS NOT NULL
          AND m.TRANSPLANTS_REQUIRED IS NOT NULL
          AND m.Berry_ID IS NOT NULL
          AND m.Testing_Lab_1_FK IS NOT NULL`,
      { cur: currentYear, next: nextYear },
    );

    if (sources.length === 0) {
      console.log("[tray-pipeline] no source crosses — nothing to do");
      return;
    }

    // Step 1 — generate per-tray rows for every source.
    const allTrays: PreTray[] = [];
    for (const s of sources) {
      allTrays.push(...buildTraysForSource(s));
    }
    if (allTrays.length === 0) {
      console.log("[tray-pipeline] no trays computed — nothing to do");
      return;
    }

    await withTransaction(async (tx) => {
      // Step 2 — wipe pipeline-owned rows for the affected years before
      // anti-join + Plate_Index allocation, so we don't double-count our own
      // prior output.  Script rows are left intact: they're authoritative,
      // and their Plate_Index values feed the MAX() lookup below.
      await tx.execute(
        `DELETE FROM dbo.T_GHTraysCreation
          WHERE Pollination_Year IN (@cur, @next)
            AND Created_By = @createdBy`,
        { cur: currentYear, next: nextYear, createdBy: CREATED_BY },
      );

      // Step 3 — anti-join.  After our delete, only script rows remain for
      // these years; skip any tray we'd be re-creating.
      const existingRows = await tx.queryMany<{ uniqueTrayCode: string; ghsmFk: number }>(
        `SELECT Unique_Tray_Code AS uniqueTrayCode, ghsm_FK AS ghsmFk
           FROM dbo.T_GHTraysCreation
          WHERE Pollination_Year IN (@cur, @next)`,
        { cur: currentYear, next: nextYear },
      );
      const existing = new Set(
        existingRows.map((r) => `${r.uniqueTrayCode}|${r.ghsmFk}`),
      );
      const newTrays = allTrays.filter(
        (t) => !existing.has(`${t.uniqueTrayCode}|${t.ghsmFk}`),
      );
      if (newTrays.length === 0) {
        console.log("[tray-pipeline] all trays already exist — nothing to insert");
        return;
      }

      // Step 4 — allocate global Plate_Index per (Berry_ID, Year).  Each
      // unique (Berry_ID, Year, ghsmFk, plateWithinProgeny) is one physical
      // plate; assign it MAX(existing Plate_Index for that berry+year) + N
      // where N is its 1-based rank in the sorted batch.
      const maxRows = await tx.queryMany<{ berryId: number; pollinationYear: number; maxIdx: number | null }>(
        `SELECT Berry_ID AS berryId, Pollination_Year AS pollinationYear,
                MAX(Plate_Index) AS maxIdx
           FROM dbo.T_GHTraysCreation
          WHERE Pollination_Year IN (@cur, @next)
          GROUP BY Berry_ID, Pollination_Year`,
        { cur: currentYear, next: nextYear },
      );
      const maxByBerryYear = new Map<string, number>();
      for (const r of maxRows) {
        maxByBerryYear.set(`${r.berryId}|${r.pollinationYear}`, r.maxIdx ?? 0);
      }

      // Group new trays into physical plates and assign each plate a global
      // Plate_Index.  A "plate" is identified by
      // (berryId, pollinationYear, ghsmFk, plateWithinProgeny).
      const plateKey = (t: PreTray) =>
        `${t.berryId}|${t.pollinationYear}|${t.ghsmFk}|${t.plateWithinProgeny}`;
      const groupKey = (t: PreTray) => `${t.berryId}|${t.pollinationYear}`;

      const platesByGroup = new Map<string, Map<string, PreTray>>(); // group → plateKey → first tray (representative)
      for (const t of newTrays) {
        const g = groupKey(t);
        const p = plateKey(t);
        let plates = platesByGroup.get(g);
        if (!plates) {
          plates = new Map();
          platesByGroup.set(g, plates);
        }
        if (!plates.has(p)) plates.set(p, t);
      }

      const plateIndexByPlateKey = new Map<string, number>();
      for (const [g, plates] of platesByGroup) {
        const baseMax = maxByBerryYear.get(g) ?? 0;
        // Sort plates within group by (ghsmFk, plateWithinProgeny) for
        // deterministic Plate_Index assignment.
        const sortedPlates = Array.from(plates.entries()).sort(
          (a, b) =>
            a[1].ghsmFk - b[1].ghsmFk ||
            a[1].plateWithinProgeny - b[1].plateWithinProgeny,
        );
        sortedPlates.forEach(([key], i) => {
          plateIndexByPlateKey.set(key, baseMax + i + 1);
        });
      }

      const toInsert: InsertTray[] = newTrays.map((t) => ({
        ...t,
        plateIndex: plateIndexByPlateKey.get(plateKey(t))!,
      }));

      // Step 5 — bulk insert (one statement per tray; volumes are modest —
      // a few thousand at most per run — and the existing transaction keeps
      // it atomic).
      for (const t of toInsert) {
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
            ghsm: t.ghsmFk, lab: t.testLabId,
            py: t.pollinationYear, plate: t.plateIndex, berry: t.berryId,
            user: CREATED_BY,
          },
        );
      }
      console.log(
        `[tray-pipeline] wrote ${toInsert.length} trays (${platesByGroup.size > 0 ? Array.from(platesByGroup.values()).reduce((n, m) => n + m.size, 0) : 0} plates) for ${sources.length} crosses`,
      );
    });
  } catch (err) {
    console.error("[tray-pipeline] error:", err);
  }
}

export function scheduleTrayPipeline(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runTrayPipeline();
  }, 10_000);
}

// Exported for unit testing / one-off backfill scripts.
export const _internals = { buildTraysForSource };
