import { Router, type IRouter } from "express";
import { queryMany, queryOne, execute, withTransaction } from "@workspace/db";
import { requireBreeder, type AuthenticatedRequest } from "../middleware/auth";
import { recalcSeedlingMaster } from "../services/recalc";
import { generateTrayCodesForSelection } from "../services/tray-pipeline";

const router: IRouter = Router();

function buildFilters(query: Record<string, unknown>): { where: string; params: Record<string, unknown> } {
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
  if (query.destinationId) {
    const dids = String(query.destinationId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (dids.length > 0) {
      const clauses = dids.map((did, i) => {
        params[`dest${i}`] = did;
        return `(m.DESTINATION1_FK = @dest${i} OR m.DESTINATION2_FK = @dest${i})`;
      });
      where.push(`(${clauses.join(" OR ")})`);
    }
  }
  if (query.active === "true") where.push("m.ACTIVE = 1");
  if (query.active === "false") where.push("m.ACTIVE = 0");
  if (query.availablePlants === "true") where.push("COALESCE(v.Extra_Transplants, 0) > 0");
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const FROM = `
  FROM dbo.vw_GH_TransplantDesk v
  INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID`;

router.get("/", async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query as Record<string, unknown>);
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const pageSize = Math.min(10000, Math.max(1, parseInt(String(req.query.pageSize || "100"))));
    const offset = (page - 1) * pageSize;
    const sortCol = req.query.sortBy === "d1Program" ? "v.D1_Program" : "v.Progeny";
    const sortDir = req.query.sortDir === "desc" ? "DESC" : "ASC";

    const countRow = await queryOne<{ total: number }>(`SELECT COUNT(*) AS total ${FROM} ${where}`, params);
    const total = countRow?.total ?? 0;

    const rows = await queryMany<Record<string, unknown>>(
      `SELECT v.GHSeedlingMaster_ID AS id, v.Progeny AS progeny,
              v.Parent1 AS parent1, v.Parent2 AS parent2,
              v.D1_Program AS d1Program, v.D2_Program AS d2Program,
              v.Destination1 AS destination1, v.Destination2 AS destination2,
              v.Transplant_Instructions AS transplantInstructions,
              v.TRANSPLANTS_REQUIRED AS transplantsRequired,
              v.Plant_Num_Transplanted AS plantNumTransplanted,
              v.Extra_Transplants AS extraTransplants,
              m.D1_Transplant_Adjustment AS d1TransplantAdjustment,
              m.D2_Transplant_Adjustment AS d2TransplantAdjustment,
              v.EXPECTED_DISCARD_PERCENTAGE AS expectedDiscardPercentage,
              v.TOTAL_SEEDLING_SHIP_REQUEST_Calc AS totalSeedlingShipRequestCalc,
              v.D1_Seedling_Ship_Request AS d1SeedlingShipRequest,
              v.D2_Seedling_Ship_Request AS d2SeedlingShipRequest,
              v.Breeder_Requested_ShipDest1_Adjustments AS breederRequestedShipDest1Adjustments,
              v.Breeder_Requested_ShipDest2_Adjustments AS breederRequestedShipDest2Adjustments,
              v.Breeder_Adjustment_Date AS breederAdjustmentDate,
              v.Plant_Num_Trans_Al_Azar AS plantNumTransAlAzar,
              v.Plant_Num_Trans_Spineless AS plantNumTransSpineless,
              v.Plant_Num_Trans_Spiny AS plantNumTransSpiny
       ${FROM} ${where}
       ORDER BY ${sortCol} ${sortDir}
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize },
    );
    res.json({
      data: rows.map((r) => ({
        ...r,
        breederAdjustmentDate: r.breederAdjustmentDate instanceof Date ? r.breederAdjustmentDate.toISOString() : null,
      })),
      total, page, pageSize,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/totals", async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query as Record<string, unknown>);
    const row = await queryOne<Record<string, number>>(
      `SELECT COALESCE(SUM(v.TRANSPLANTS_REQUIRED), 0) AS transplantsRequired,
              COALESCE(SUM(v.Plant_Num_Transplanted), 0) AS plantNumTransplanted,
              COALESCE(SUM(v.Extra_Transplants), 0) AS extraTransplants,
              COALESCE(SUM(m.D1_Transplant_Adjustment), 0) AS d1TransplantAdjustment,
              COALESCE(SUM(m.D2_Transplant_Adjustment), 0) AS d2TransplantAdjustment,
              CASE WHEN COUNT(*) > 0 THEN COALESCE(AVG(v.EXPECTED_DISCARD_PERCENTAGE), 0) ELSE 0 END AS expectedDiscardPercentage,
              COALESCE(SUM(v.TOTAL_SEEDLING_SHIP_REQUEST_Calc), 0) AS totalSeedlingShipRequestCalc,
              COALESCE(SUM(v.D1_Seedling_Ship_Request), 0) AS d1SeedlingShipRequest,
              COALESCE(SUM(v.D2_Seedling_Ship_Request), 0) AS d2SeedlingShipRequest,
              COALESCE(SUM(v.Breeder_Requested_ShipDest1_Adjustments), 0) AS breederRequestedShipDest1Adjustments,
              COALESCE(SUM(v.Breeder_Requested_ShipDest2_Adjustments), 0) AS breederRequestedShipDest2Adjustments,
              COALESCE(SUM(v.Plant_Num_Trans_Al_Azar), 0) AS plantNumTransAlAzar,
              COALESCE(SUM(v.Plant_Num_Trans_Spineless), 0) AS plantNumTransSpineless,
              COALESCE(SUM(v.Plant_Num_Trans_Spiny), 0) AS plantNumTransSpiny
       ${FROM} ${where}`,
      params,
    );
    res.json(row ?? {});
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

function toIntOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}

// ── GET /transplant/tray-codes ────────────────────────────────────────
// Rows from vw_GH_UniqueTrayCode for the Transplant page's "Export Tray
// Codes and Plate Indexes CSV" button. Filter set mirrors the Transplant
// gallery: global (berryId, teamId, pollinationYear, spCrosses) + local
// (programId, destinationId).
//
// The view exposes NAME columns (Berry, Team_Name, Program, Destination)
// but the frontend sends IDs — so each ID filter maps via a subquery.

router.get("/tray-codes", async (req, res) => {
  try {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (req.query.berryId) {
      where.push("v.Berry = (SELECT BerryType FROM TPN.dbo.M_BerryID WHERE PK_BerryID = @berryId)");
      params.berryId = parseInt(String(req.query.berryId));
    }
    if (req.query.teamId) {
      where.push("v.Team_Name = (SELECT Team_Name FROM dbo.M_GHTeams WHERE Team_ID = @teamId)");
      params.teamId = parseInt(String(req.query.teamId));
    }
    if (req.query.pollinationYear) {
      where.push("v.Pollination_Year = @py");
      params.py = parseInt(String(req.query.pollinationYear));
    }
    if (req.query.spCrosses === "true") {
      // The view stores SP_Crosses as a string 'True'/'False'.
      where.push("v.SP_Crosses = 'True'");
    }
    if (req.query.programId) {
      const pids = String(req.query.programId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      if (pids.length > 0) {
        const placeholders = pids.map((pid, i) => { params[`prog${i}`] = pid; return `@prog${i}`; });
        where.push(`v.Program IN (SELECT SrcBreedingProgram FROM TPN.dbo.M_SrcBreedingProgram WHERE SrcBreedingProgramId IN (${placeholders.join(",")}))`);
      }
    }
    if (req.query.destinationId) {
      const dids = String(req.query.destinationId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      if (dids.length > 0) {
        const placeholders = dids.map((did, i) => { params[`dest${i}`] = did; return `@dest${i}`; });
        where.push(`v.Destination IN (SELECT LocationName FROM TPN.dbo.M_Locations WHERE Location_ID IN (${placeholders.join(",")}))`);
      }
    }

    const rows = await queryMany<{
      uniqueTrayCode: string | null;
      plantQty: number | null;
      pollinationYear: number | null;
      plateIndex: number | null;
      berry: string | null;
      progeny: string | null;
      program: string | null;
      labName: string | null;
      trayQty: number | null;
      screening: string | null;
      spCrosses: string | null;
      teamName: string | null;
      destination: string | null;
    }>(
      `SELECT v.Unique_Tray_Code AS uniqueTrayCode,
              v.Plant_Qty         AS plantQty,
              v.Pollination_Year  AS pollinationYear,
              v.Plate_Index       AS plateIndex,
              v.Berry             AS berry,
              v.PROGENY           AS progeny,
              v.Program           AS program,
              v.Lab_Name          AS labName,
              v.Tray_Qty          AS trayQty,
              v.SCREENING         AS screening,
              v.SP_Crosses        AS spCrosses,
              v.Team_Name         AS teamName,
              v.Destination       AS destination
         FROM dbo.vw_GH_UniqueTrayCode v
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY v.PROGENY, v.Plate_Index, v.Unique_Tray_Code`,
      params,
    );

    res.json({ data: rows });
  } catch (err) {
    console.error("GET /api/transplant/tray-codes error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ── POST /transplant/generate-tray-codes ──────────────────────────────
// Button-triggered tray-code generation for a single Berry + Team + Year
// selection (Admin3-gated in the UI). Generates/updates tray codes for
// deadline-passed, seed-bearing progenies and cancels zero-seed ones. The
// frontend calls the read-only GET /tray-codes afterward to download the CSV.
router.post("/generate-tray-codes", async (req, res) => {
  try {
    const berryId = toIntOrNull(req.body?.berryId);
    const teamId = toIntOrNull(req.body?.teamId);
    const pollinationYear = toIntOrNull(req.body?.pollinationYear);
    if (berryId == null || teamId == null || pollinationYear == null) {
      res.status(400).json({ message: "berryId, teamId and pollinationYear are required" });
      return;
    }
    const summary = await generateTrayCodesForSelection({ berryId, teamId, pollinationYear });
    res.json(summary);
  } catch (err) {
    console.error("POST /api/transplant/generate-tray-codes error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.patch("/batch", requireBreeder, async (req, res) => {
  try {
    const { updates } = req.body ?? {};
    if (!Array.isArray(updates)) { res.status(400).json({ message: "updates must be an array" }); return; }
    const user = (req as AuthenticatedRequest).user?.name ?? "system";
    let updatedCount = 0;

    await withTransaction(async (tx) => {
      for (const u of updates) {
        if (!u.id || typeof u.id !== "number") continue;
        const sets: string[] = [];
        const p: Record<string, unknown> = { id: u.id, user };
        const d1 = toIntOrNull(u.d1TransplantAdjustment);
        const d2 = toIntOrNull(u.d2TransplantAdjustment);
        if (d1 !== undefined) { sets.push("D1_Transplant_Adjustment = @d1"); p.d1 = d1; }
        if (d2 !== undefined) { sets.push("D2_Transplant_Adjustment = @d2"); p.d2 = d2; }
        if (sets.length === 0) continue;
        sets.push("Modified_Date = GETDATE()", "Modified_By = @user");
        await tx.execute(
          `UPDATE dbo.M_GHSeedlingMaster SET ${sets.join(", ")} WHERE GHSeedlingMaster_ID = @id`,
          p,
        );
        updatedCount++;
      }
    });
    // Trigger recalculation so TRANSPLANTS_REQUIRED and other derived columns
    // pick up the new D1/D2 adjustments (only rows past their deadline are skipped).
    if (updatedCount > 0) {
      await recalcSeedlingMaster();
    }
    res.json({ updatedCount });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

export default router;
