import { Router, type IRouter } from "express";
import { queryMany, queryOne } from "@workspace/db";

const router: IRouter = Router();

// ── Shared enrichment SQL ──────────────────────────────────────────────────
//
// The two screening views expose only aggregate/dimension columns, so the
// export-only fields (lab, barcode, collector, markers) are layered on here
// rather than in the views.
//
// SQL Server 2016 / compat 130 → no STRING_AGG; multi-value fields use the
// FOR XML PATH idiom.

// One row per progeny with its markers pivoted into marker1..marker5.
// The link table holds duplicates (e.g. "Pisco" twice on one progeny), so the
// inner DISTINCT dedupes before ranking.  Max observed is 5 distinct markers.
const MARKERS_CTE = `progeny_markers AS (
    SELECT ghsm_FK,
           MAX(CASE WHEN rn = 1 THEN markerName END) AS marker1,
           MAX(CASE WHEN rn = 2 THEN markerName END) AS marker2,
           MAX(CASE WHEN rn = 3 THEN markerName END) AS marker3,
           MAX(CASE WHEN rn = 4 THEN markerName END) AS marker4,
           MAX(CASE WHEN rn = 5 THEN markerName END) AS marker5
    FROM (
      SELECT ghsm_FK, markerName,
             ROW_NUMBER() OVER (PARTITION BY ghsm_FK ORDER BY markerName) AS rn
      FROM (
        SELECT DISTINCT pm.ghsm_FK,
               COALESCE(NULLIF(LTRIM(RTRIM(ml.Marker_Alias_Driscolls)), ''), ml.Trait_Marker) AS markerName
        FROM dbo.T_GHProgenyMarkers pm
        INNER JOIN dbo.M_GHMarkerLabs ml ON ml.GHMarkerLabs_ID = pm.Marker_ID
      ) d
      WHERE d.markerName IS NOT NULL
    ) r
    WHERE r.rn <= 5
    GROUP BY ghsm_FK
  )`;

/**
 * Distinct, "; "-joined Lab_Barcode values from active plate-collection rows.
 * `innerWhere` correlates the subquery to the outer row (by plate or progeny).
 * A plate re-collected later carries a second barcode, so this can be a list.
 */
function labBarcodeExpr(innerWhere: string): string {
  return `STUFF((SELECT DISTINCT '; ' + LTRIM(RTRIM(pcb.Lab_Barcode))
                   FROM dbo.T_GHPlateCollection pcb
                   INNER JOIN dbo.T_GHTraysCreation tcb ON tcb.Tray_Creation_ID = pcb.Tray_Creation_ID
                   WHERE pcb.Active = 1 AND ${innerWhere}
                     AND LTRIM(RTRIM(ISNULL(pcb.Lab_Barcode, ''))) <> ''
                   FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '')`;
}

/**
 * Created By / Created Date come from the *earliest* active plate-collection
 * row, so the two always describe the same event rather than being mixed from
 * different collectors.
 */
function createdByApply(innerWhere: string): string {
  return `OUTER APPLY (
    SELECT TOP 1 pcc.Created_By AS createdBy, pcc.Created_DateTime AS createdDate
    FROM dbo.T_GHPlateCollection pcc
    INNER JOIN dbo.T_GHTraysCreation tcc ON tcc.Tray_Creation_ID = pcc.Tray_Creation_ID
    WHERE pcc.Active = 1 AND ${innerWhere}
    ORDER BY pcc.Created_DateTime, pcc.PlateCollection_ID
  ) cr`;
}

const toIso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);

// ── Plates view (no GHSeedlingMaster_ID → berry/team filter by name) ──

function buildPlateFilters(query: Record<string, unknown>): { where: string; params: Record<string, unknown> } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.berryId) {
    where.push("v.Berry = (SELECT BerryType FROM TPN.dbo.M_BerryID WHERE PK_BerryID = @berryId)");
    params.berryId = parseInt(String(query.berryId));
  }
  if (query.teamId) {
    where.push("v.Team_Name = (SELECT Team_Name FROM dbo.M_GHTeams WHERE Team_ID = @teamId)");
    params.teamId = parseInt(String(query.teamId));
  }
  if (query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(query.pollinationYear)); }
  if (query.progeny) { where.push("v.Progeny LIKE @prog"); params.prog = `%${String(query.progeny)}%`; }
  if (query.programId) {
    const pids = String(query.programId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (pids.length > 0) {
      const placeholders = pids.map((pid, i) => { params[`prog${i}`] = pid; return `@prog${i}`; });
      where.push(`v.D1_Program IN (SELECT SrcBreedingProgram FROM TPN.dbo.M_SrcBreedingProgram WHERE SrcBreedingProgramId IN (${placeholders.join(",")}))`);
    }
  }
  if (query.testingLab) { where.push("v.Testing_Lab_1 LIKE @lab"); params.lab = `%${String(query.testingLab)}%`; }
  if (query.plateIndex) { where.push("v.Plate_Index = @plate"); params.plate = parseInt(String(query.plateIndex)); }
  if (query.screening === "true") where.push("v.Screening = 1");
  if (query.screening === "false") where.push("v.Screening = 0");
  if (query.sorted === "true") where.push("v.Sorted = 1");
  if (query.sorted === "false") where.push("v.Sorted = 0");
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

router.get("/screening/plates", async (req, res) => {
  try {
    const page = parseInt(String(req.query.page)) || 1;
    const pageSize = Math.min(parseInt(String(req.query.pageSize)) || 25, 5000);
    const offset = (page - 1) * pageSize;
    const { where, params } = buildPlateFilters(req.query as Record<string, unknown>);

    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM dbo.vw_GH_MarkerPlateDesk v ${where}`, params,
    );
    const total = countRow?.total ?? 0;

    const rows = await queryMany<Record<string, unknown>>(
      `WITH ${MARKERS_CTE}
       SELECT v.Plate_Index AS id, v.Plate_Index AS plateIndex, v.Progeny AS progeny,
              v.Testing_Lab_1 AS testingLab,
              lab.Lab_Name AS labName,
              ${labBarcodeExpr("tcb.Plate_Index = v.Plate_Index")} AS labBarcode,
              cr.createdBy, cr.createdDate,
              mk.marker1, mk.marker2, mk.marker3, mk.marker4, mk.marker5,
              v.Samples_Required AS samplesRequired, v.Samples_Collected AS samplesCollected,
              v.Sample_Collection_Date AS sampleCollectionDate,
              v.Total_Keep_Request AS totalKeepRequest, v.Total_Keep_Actual AS totalKeepActual,
              v.Total_Discards_Actual AS totalDiscardsActual, v.Discard_Date AS discardDate,
              v.Sorted AS sorted,
              v.Sort_Group1 AS sortGroup1, v.Sort_Group2 AS sortGroup2, v.Sort_Group3 AS sortGroup3,
              v.Sort_Group4 AS sortGroup4, v.Sort_Group5 AS sortGroup5,
              v.Screening AS screening, v.Berry AS berry, v.Team_Name AS teamName,
              v.D1_Program AS d1Program, v.Pollination_Year AS pollinationYear
       FROM dbo.vw_GH_MarkerPlateDesk v
       -- A plate index maps to exactly one progeny and one lab (verified: no
       -- Plate_Index spans multiple ghsm_FK), so MIN() just picks that value.
       OUTER APPLY (
         SELECT MIN(tcp.ghsm_FK) AS ghsmId, MIN(tcp.Test_Lab_ID) AS testLabId
         FROM dbo.T_GHTraysCreation tcp
         WHERE tcp.Plate_Index = v.Plate_Index
       ) pl
       LEFT JOIN dbo.M_GHLabs lab ON lab.GHLab_ID = pl.testLabId
       LEFT JOIN progeny_markers mk ON mk.ghsm_FK = pl.ghsmId
       ${createdByApply("tcc.Plate_Index = v.Plate_Index")}
       ${where}
       ORDER BY v.Plate_Index
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize },
    );
    res.json({
      data: rows.map((r) => ({
        ...r,
        berryId: null, teamId: null,
        sampleCollectionDate: toIso(r.sampleCollectionDate),
        discardDate: toIso(r.discardDate),
        createdDate: toIso(r.createdDate),
        sorted: r.sorted === true,
        screening: r.screening === true,
      })),
      total, page, pageSize, totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

router.get("/screening/plates/totals", async (req, res) => {
  try {
    const { where, params } = buildPlateFilters(req.query as Record<string, unknown>);
    const row = await queryOne<Record<string, number>>(
      `SELECT COUNT(*) AS [rowCount],
              COALESCE(SUM(v.Samples_Required), 0) AS samplesRequired,
              COALESCE(SUM(v.Samples_Collected), 0) AS samplesCollected,
              COALESCE(SUM(v.Total_Keep_Request), 0) AS totalKeepRequest,
              COALESCE(SUM(v.Total_Keep_Actual), 0) AS totalKeepActual,
              COALESCE(SUM(v.Total_Discards_Actual), 0) AS totalDiscardsActual,
              COALESCE(SUM(v.Sort_Group1), 0) AS sortGroup1,
              COALESCE(SUM(v.Sort_Group2), 0) AS sortGroup2,
              COALESCE(SUM(v.Sort_Group3), 0) AS sortGroup3,
              COALESCE(SUM(v.Sort_Group4), 0) AS sortGroup4,
              COALESCE(SUM(v.Sort_Group5), 0) AS sortGroup5
       FROM dbo.vw_GH_MarkerPlateDesk v ${where}`,
      params,
    );
    res.json(row ?? {});
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── Progeny view (has GHSeedlingMaster_ID → can join M_GHSeedlingMaster) ──

function buildProgenyFilters(query: Record<string, unknown>): { where: string; params: Record<string, unknown> } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(query.berryId)); }
  if (query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(query.teamId)); }
  if (query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(query.pollinationYear)); }
  if (query.spCrosses === "true") where.push("v.SP_Crosses = 1");
  if (query.progeny) { where.push("v.Progeny LIKE @prog"); params.prog = `%${String(query.progeny)}%`; }
  if (query.programId) {
    const pids = String(query.programId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (pids.length > 0) {
      const clauses = pids.map((pid, i) => {
        params[`prog${i}`] = pid;
        return `(m.D1_PROGRAM_FK = @prog${i} OR m.D2_PROGRAM_FK = @prog${i})`;
      });
      where.push(`(${clauses.join(" OR ")})`);
    }
  }
  if (query.screening === "true") where.push("v.SCREENING = 1");
  if (query.screening === "false") where.push("v.SCREENING = 0");
  if (query.sorted === "true") where.push("v.Sorted = 1");
  if (query.sorted === "false") where.push("v.Sorted = 0");
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

router.get("/screening/progeny", async (req, res) => {
  try {
    const page = parseInt(String(req.query.page)) || 1;
    const pageSize = Math.min(parseInt(String(req.query.pageSize)) || 25, 5000);
    const offset = (page - 1) * pageSize;
    const { where, params } = buildProgenyFilters(req.query as Record<string, unknown>);
    const FROM = "FROM dbo.vw_GH_MarkerProgenyDesk v INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID";

    const countRow = await queryOne<{ total: number }>(`SELECT COUNT(*) AS total ${FROM} ${where}`, params);
    const total = countRow?.total ?? 0;

    const rows = await queryMany<Record<string, unknown>>(
      `WITH ${MARKERS_CTE}
       SELECT v.GHSeedlingMaster_ID AS id, v.Progeny AS progeny,
              v.D1_Program AS d1Program, v.D2_Program AS d2Program,
              tr.labName,
              ${labBarcodeExpr("tcb.ghsm_FK = v.GHSeedlingMaster_ID")} AS labBarcode,
              tr.startingPlateIndex, tr.endingPlateIndex,
              cr.createdBy, cr.createdDate,
              mk.marker1, mk.marker2, mk.marker3, mk.marker4, mk.marker5,
              NULL AS totalPlatesRequired, NULL AS platesCollected,
              v.Sample_Required AS sampleRequired, v.Samples_Collected AS samplesCollected,
              v.Keep_Request AS keepRequest, v.Keep_Actual AS keepActual,
              v.Total_Discards_Actual AS totalDiscardsActual,
              v.Sorted AS sorted,
              v.Sort_Group1 AS sortGroup1, v.Sort_Group2 AS sortGroup2, v.Sort_Group3 AS sortGroup3,
              v.Sort_Group4 AS sortGroup4, v.Sort_Group5 AS sortGroup5,
              v.Testing_Lab1 AS testingLab1, v.Testing_Lab2 AS testingLab2,
              v.SCREENING AS screening,
              v.Berry AS berry, m.Berry_ID AS berryId,
              v.Team_Name AS teamName, m.Team_ID AS teamId,
              v.Pollination_Year AS pollinationYear
       ${FROM}
       -- Plate-index range and destination lab(s) across all of this progeny's trays.
       OUTER APPLY (
         SELECT MIN(tcr.Plate_Index) AS startingPlateIndex,
                MAX(tcr.Plate_Index) AS endingPlateIndex,
                STUFF((SELECT DISTINCT '; ' + l2.Lab_Name
                       FROM dbo.T_GHTraysCreation tcl
                       INNER JOIN dbo.M_GHLabs l2 ON l2.GHLab_ID = tcl.Test_Lab_ID
                       WHERE tcl.ghsm_FK = v.GHSeedlingMaster_ID
                       FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '') AS labName
         FROM dbo.T_GHTraysCreation tcr
         WHERE tcr.ghsm_FK = v.GHSeedlingMaster_ID
       ) tr
       LEFT JOIN progeny_markers mk ON mk.ghsm_FK = v.GHSeedlingMaster_ID
       ${createdByApply("pcc.ghsm_FK = v.GHSeedlingMaster_ID")}
       ${where}
       ORDER BY v.Progeny
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize },
    );
    res.json({
      data: rows.map((r) => ({
        ...r,
        createdDate: toIso(r.createdDate),
        sorted: r.sorted === true,
        screening: r.screening === true,
      })),
      total, page, pageSize, totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

router.get("/screening/progeny/totals", async (req, res) => {
  try {
    const { where, params } = buildProgenyFilters(req.query as Record<string, unknown>);
    const row = await queryOne<Record<string, number>>(
      `SELECT COUNT(*) AS [rowCount],
              COALESCE(SUM(v.Sample_Required), 0) AS sampleRequired,
              COALESCE(SUM(v.Samples_Collected), 0) AS samplesCollected,
              COALESCE(SUM(v.Keep_Request), 0) AS keepRequest,
              COALESCE(SUM(v.Keep_Actual), 0) AS keepActual,
              COALESCE(SUM(v.Total_Discards_Actual), 0) AS totalDiscardsActual,
              COALESCE(SUM(v.Sort_Group1), 0) AS sortGroup1,
              COALESCE(SUM(v.Sort_Group2), 0) AS sortGroup2,
              COALESCE(SUM(v.Sort_Group3), 0) AS sortGroup3,
              COALESCE(SUM(v.Sort_Group4), 0) AS sortGroup4,
              COALESCE(SUM(v.Sort_Group5), 0) AS sortGroup5
       FROM dbo.vw_GH_MarkerProgenyDesk v
       INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
       ${where}`,
      params,
    );
    res.json(row ?? {});
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

router.get("/screening/labs", async (_req, res) => {
  try {
    const rows = await queryMany<{ testingLab: string | null }>(
      `SELECT DISTINCT Testing_Lab_1 AS testingLab FROM dbo.vw_GH_MarkerPlateDesk WHERE Testing_Lab_1 IS NOT NULL ORDER BY Testing_Lab_1`,
    );
    res.json(rows.map((r) => r.testingLab));
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

export default router;
