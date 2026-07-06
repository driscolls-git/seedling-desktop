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
  if (query.active === "true") where.push("m.ACTIVE = 1");
  if (query.active === "false") where.push("m.ACTIVE = 0");
  if (query.seedSowToGo === "true") where.push("COALESCE(v.Seed_Sow_To_Go, 0) > 0");
  if (query.sowSeed === "true") where.push("v.SOW_SEED = 1");
  if (query.acidInDateRange === "true") where.push("v.Acid_In_Date_Range = 1");
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const FROM = `
  FROM dbo.vw_GHSeedDesk v
  INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID`;

router.get("/", async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query as Record<string, unknown>);
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const pageSize = Math.min(10000, Math.max(1, parseInt(String(req.query.pageSize || "100"))));
    const offset = (page - 1) * pageSize;
    const sortCol = req.query.sortBy === "d1Program" ? "v.D1_Program" : "v.PROGENY";
    const sortDir = req.query.sortDir === "desc" ? "DESC" : "ASC";

    const countRow = await queryOne<{ total: number }>(`SELECT COUNT(*) AS total ${FROM} ${where}`, params);
    const total = countRow?.total ?? 0;

    const rows = await queryMany<{
      id: number; progeny: string | null; d1Program: string | null; d2Program: string | null;
      seedWeightRequired: number | null; seedWeightInventory: number | null;
      seedWeightVariance: number | null; seedAcidWeightVariance: number | null;
      acidTreatAll: boolean | null; seedReadyForAcid: boolean | null; acidInDateRange: boolean | null;
      acidStartDate: Date | null; acidDeadlineDate: Date | null;
      seedWeightAcidTreated: number | null;
      sowSeed: boolean | null;
      seedWeightToSow: number | null; seedWeightToBank: number | null;
      totalSeedWeightSown: number | null; seedSowToGo: number | null;
      totalFruitCollected: number | null; commentsFruit: string | null;
    }>(
      `SELECT v.GHSeedlingMaster_ID AS id, v.PROGENY AS progeny,
              v.D1_Program AS d1Program, v.D2_Program AS d2Program,
              v.Total_Fruit_Collected AS totalFruitCollected,
              v.Comments_Fruit AS commentsFruit,
              v.SEED_WEIGHT_REQUIRED AS seedWeightRequired,
              v.Seed_Weight_Inventory AS seedWeightInventory,
              v.Seed_Weight_Variance AS seedWeightVariance,
              v.Acid_Treat_All AS acidTreatAll, v.Seed_Ready_For_Acid AS seedReadyForAcid,
              v.Acid_In_Date_Range AS acidInDateRange,
              v.Acid_Start_Date AS acidStartDate, v.Acid_Deadline_Date AS acidDeadlineDate,
              v.Seed_Weight_Acid_Treated AS seedWeightAcidTreated,
              v.Seed_Acid_Weight_Variance AS seedAcidWeightVariance,
              v.SOW_SEED AS sowSeed,
              v.Seed_Weight_To_Sow AS seedWeightToSow, v.Seed_Weight_To_Bank AS seedWeightToBank,
              v.Total_Seed_Weight_Sown AS totalSeedWeightSown, v.Seed_Sow_To_Go AS seedSowToGo
       ${FROM} ${where}
       ORDER BY ${sortCol} ${sortDir}
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize },
    );
    res.json({
      data: rows.map((r) => ({
        ...r,
        acidTreatAll: r.acidTreatAll === true,
        seedReadyForAcid: r.seedReadyForAcid === true,
        acidInDateRange: r.acidInDateRange === true,
        sowSeed: r.sowSeed === true,
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
      `SELECT COALESCE(SUM(v.SEED_WEIGHT_REQUIRED), 0) AS seedWeightRequired,
              COALESCE(SUM(v.Seed_Weight_Inventory), 0) AS seedWeightInventory,
              COALESCE(SUM(v.Seed_Weight_Variance), 0) AS seedWeightVariance,
              COALESCE(SUM(v.Seed_Weight_Acid_Treated), 0) AS seedWeightAcidTreated,
              COALESCE(SUM(v.Seed_Acid_Weight_Variance), 0) AS seedAcidWeightVariance,
              COALESCE(SUM(v.Seed_Weight_To_Sow), 0) AS seedWeightToSow,
              COALESCE(SUM(v.Seed_Weight_To_Bank), 0) AS seedWeightToBank,
              COALESCE(SUM(v.Total_Seed_Weight_Sown), 0) AS totalSeedWeightSown,
              COALESCE(SUM(CAST(v.SOW_SEED AS INT)), 0) AS sowSeed,
              COALESCE(SUM(v.Seed_Sow_To_Go), 0) AS seedSowToGo
       ${FROM} ${where}`,
      params,
    );
    res.json(row ?? {});
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;
