import { Router, type IRouter } from "express";
import { queryMany, queryOne } from "@workspace/db";

const router: IRouter = Router();

function buildFilters(query: Record<string, unknown>): { where: string; params: Record<string, unknown> } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(query.berryId)); }
  if (query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(query.teamId)); }
  if (query.pollinationYear) { where.push("v.POLLINATION_YEAR = @py"); params.py = parseInt(String(query.pollinationYear)); }
  if (query.spCrosses === "true") where.push("v.SP_Crosses = 1");
  if (query.progeny) { where.push("v.PROGENY LIKE @prog"); params.prog = `%${String(query.progeny)}%`; }
  if (query.parent) { where.push("(v.PARENT1 LIKE @parent OR v.PARENT2 LIKE @parent)"); params.parent = `%${String(query.parent)}%`; }
  if (query.programId) {
    const pids = String(query.programId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (pids.length > 0) {
      const clauses = pids.map((pid, i) => {
        params[`prog${i}`] = pid;
        return `m.D1_PROGRAM_FK = @prog${i}`;
      });
      where.push(`(${clauses.join(" OR ")})`);
    }
  }
  if (query.active === "true") where.push("m.ACTIVE = 1");
  if (query.active === "false") where.push("m.ACTIVE = 0");
  if (query.pollinationToGo === "true") {
    where.push("(COALESCE(v.FLOWERS_TO_POLLINATE_REQUIRED, 0) - COALESCE(v.Successful_Pollinations_Calc, 0)) > 0");
  }
  if (query.emasculationToGo === "true") {
    where.push("COALESCE(v.Emasculated_Ready_To_Pollinate_Calc, 0) > 0");
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const POLL_FROM = `
  FROM dbo.vw_GH_PollinationDesk v
  INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID`;

router.get("/", async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query as Record<string, unknown>);
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const pageSize = Math.min(10000, Math.max(1, parseInt(String(req.query.pageSize || "100"))));
    const offset = (page - 1) * pageSize;
    const sortCol = req.query.sortBy === "d1Program" ? "v.D1_Program" : "v.PROGENY";
    const sortDir = req.query.sortDir === "desc" ? "DESC" : "ASC";

    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total ${POLL_FROM} ${where}`,
      params,
    );
    const total = countRow?.total ?? 0;

    const rows = await queryMany<{
      id: number; progeny: string | null; parent1: string | null; parent2: string | null;
      bulkParent3: string | null; d1Program: string | null;
      reciprocalDone: boolean | null;
      flowersRequiredForPollen: number | null;
      totalFlowersCollected: number | null;
      flowersToPollinateRequired: number | null;
      successfulPollinations: number | null;
      pollinateToGo: number | null;
      emasculationToGo: number | null;
    }>(
      `SELECT v.GHSeedlingMaster_ID AS id, v.PROGENY AS progeny,
              v.PARENT1 AS parent1, v.PARENT2 AS parent2, v.BULK_PARENT3 AS bulkParent3,
              v.D1_Program AS d1Program, v.Reciprocal_Done AS reciprocalDone,
              v.FLOWERS_REQUIRED_FOR_POLLEN AS flowersRequiredForPollen,
              v.Total_Flowers_Collected AS totalFlowersCollected,
              v.FLOWERS_TO_POLLINATE_REQUIRED AS flowersToPollinateRequired,
              v.Successful_Pollinations_Calc AS successfulPollinations,
              (COALESCE(v.FLOWERS_TO_POLLINATE_REQUIRED, 0) - COALESCE(v.Successful_Pollinations_Calc, 0)) AS pollinateToGo,
              v.Emasculated_Ready_To_Pollinate_Calc AS emasculationToGo
       ${POLL_FROM} ${where}
       ORDER BY ${sortCol} ${sortDir}
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize },
    );

    res.json({
      data: rows.map((r) => ({ ...r, reciprocalDone: r.reciprocalDone === true, goodFlowersCollected: null })),
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
      `SELECT
         COALESCE(SUM(CAST(v.Reciprocal_Done AS INT)), 0) AS reciprocalDone,
         COALESCE(SUM(v.FLOWERS_REQUIRED_FOR_POLLEN), 0) AS flowersRequiredForPollen,
         COALESCE(SUM(v.Total_Flowers_Collected), 0) AS totalFlowersCollected,
         0 AS goodFlowersCollected,
         COALESCE(SUM(v.FLOWERS_TO_POLLINATE_REQUIRED), 0) AS flowersToPollinateRequired,
         COALESCE(SUM(v.Successful_Pollinations_Calc), 0) AS successfulPollinations,
         COALESCE(SUM(COALESCE(v.FLOWERS_TO_POLLINATE_REQUIRED, 0) - COALESCE(v.Successful_Pollinations_Calc, 0)), 0) AS pollinateToGo,
         COALESCE(SUM(v.Emasculated_Ready_To_Pollinate_Calc), 0) AS emasculationToGo
       ${POLL_FROM} ${where}`,
      params,
    );
    res.json(row ?? {});
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ── /label-export (queries vw_GH_CrossesDesk with cross filters) ──
function buildCrossesFilters(query: Record<string, unknown>): { where: string; params: Record<string, unknown> } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(query.berryId)); }
  if (query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(query.teamId)); }
  if (query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(query.pollinationYear)); }
  if (query.spCrosses === "true") where.push("v.SP_Crosses = 1");
  if (query.progeny) { where.push("v.Progeny LIKE @prog"); params.prog = `%${String(query.progeny)}%`; }
  if (query.parent) { where.push("(v.PARENT1 LIKE @parent OR v.PARENT2 LIKE @parent)"); params.parent = `%${String(query.parent)}%`; }
  if (query.programId) {
    const pids = String(query.programId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (pids.length > 0) {
      const clauses = pids.map((pid, i) => {
        params[`prog${i}`] = pid;
        return `m.D1_PROGRAM_FK = @prog${i}`;
      });
      where.push(`(${clauses.join(" OR ")})`);
    }
  }
  if (query.active === "true") where.push("v.Active = 1");
  if (query.active === "false") where.push("v.Active = 0");
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

router.get("/label-export", async (req, res) => {
  try {
    const { where, params } = buildCrossesFilters(req.query as Record<string, unknown>);
    const rows = await queryMany<{
      progeny: string | null; flowersToPollinateRequired: number | null;
      parent1: string | null;
      p1L1fc: string | null; p1L1: string | null; p1L2fc: string | null; p1L2: string | null;
      p1L3fc: string | null; p1L3: string | null; p1L4fc: string | null; p1L4: string | null;
      parent2: string | null;
      p2L1fc: string | null; p2L1: string | null; p2L2fc: string | null; p2L2: string | null;
      p2L3fc: string | null; p2L3: string | null; p2L4fc: string | null; p2L4: string | null;
      reciprocalDone: boolean | null; newLabels: boolean | null;
    }>(
      `SELECT v.Progeny AS progeny, v.FLOWERS_TO_POLLINATE_REQUIRED AS flowersToPollinateRequired,
              v.PARENT1 AS parent1,
              v.P1L1FC AS p1L1fc, v.P1L1 AS p1L1, v.P1L2FC AS p1L2fc, v.P1L2 AS p1L2,
              v.P1L3FC AS p1L3fc, v.P1L3 AS p1L3, v.P1L4FC AS p1L4fc, v.P1L4 AS p1L4,
              v.PARENT2 AS parent2,
              v.P2L1FC AS p2L1fc, v.P2L1 AS p2L1, v.P2L2FC AS p2L2fc, v.P2L2 AS p2L2,
              v.P2L3FC AS p2L3fc, v.P2L3 AS p2L3, v.P2L4FC AS p2L4fc, v.P2L4 AS p2L4,
              v.Reciprocal_Done AS reciprocalDone, v.New_Labels AS newLabels
         FROM dbo.vw_GH_CrossesDesk v
         INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
         ${where}
        ORDER BY v.Progeny DESC`,
      params,
    );
    res.json(rows.map((r) => ({ ...r, reciprocalDone: r.reciprocalDone === true, newLabels: r.newLabels === true })));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;
