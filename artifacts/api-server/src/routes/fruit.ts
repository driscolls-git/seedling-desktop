import { Router, type IRouter } from "express";
import { queryMany, queryOne } from "@workspace/db";

const router: IRouter = Router();

function buildFilters(query: Record<string, unknown>): { where: string; params: Record<string, unknown> } {
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
      const clauses = pids.map((pid, i) => { params[`prog${i}`] = pid; return `m.D1_PROGRAM_FK = @prog${i}`; });
      where.push(`(${clauses.join(" OR ")})`);
    }
  }
  if (query.active === "true") where.push("v.Active = 1");
  if (query.active === "false") where.push("v.Active = 0");
  if (query.fruitToGo === "true") where.push("COALESCE(v.Fruit_Collected_VS_Successful_Pollinations, 0) < 0");
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const FROM = `
  FROM dbo.vw_GH_FruitDesk v
  INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID`;

router.get("/", async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query as Record<string, unknown>);
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const pageSize = Math.min(10000, Math.max(1, parseInt(String(req.query.pageSize || "100"))));
    const offset = (page - 1) * pageSize;
    const sortCol = req.query.sortBy === "d1Program" ? "v.D1_Program" : "v.Progeny";
    const sortDir = req.query.sortDir === "desc" ? "DESC" : "ASC";

    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total ${FROM} ${where}`, params,
    );
    const total = countRow?.total ?? 0;

    const rows = await queryMany<{
      id: number; progeny: string | null; parent1: string | null; parent2: string | null;
      d1Program: string | null; reciprocalDone: boolean | null;
      fruitRequired: number | null; totalFruitCollected: number | null; fruitToGo: number | null;
    }>(
      `SELECT v.GHSeedlingMaster_ID AS id, v.Progeny AS progeny,
              v.PARENT1 AS parent1, v.PARENT2 AS parent2, v.D1_Program AS d1Program,
              v.Reciprocal_Done AS reciprocalDone,
              v.FRUIT_REQUIRED AS fruitRequired, v.Total_Fruit_Collected AS totalFruitCollected,
              (-1 * COALESCE(v.Fruit_Collected_VS_Successful_Pollinations, 0)) AS fruitToGo
       ${FROM} ${where}
       ORDER BY ${sortCol} ${sortDir}
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize },
    );
    res.json({ data: rows.map((r) => ({ ...r, reciprocalDone: r.reciprocalDone === true })), total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/totals", async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query as Record<string, unknown>);
    const row = await queryOne<Record<string, number>>(
      `SELECT COALESCE(SUM(CAST(v.Reciprocal_Done AS INT)), 0) AS reciprocalDone,
              COALESCE(SUM(v.FRUIT_REQUIRED), 0) AS fruitRequired,
              COALESCE(SUM(v.Total_Fruit_Collected), 0) AS totalFruitCollected,
              COALESCE(SUM(-1 * COALESCE(v.Fruit_Collected_VS_Successful_Pollinations, 0)), 0) AS fruitToGo
       ${FROM} ${where}`,
      params,
    );
    res.json(row ?? {});
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;
