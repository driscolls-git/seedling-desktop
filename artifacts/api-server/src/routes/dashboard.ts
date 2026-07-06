import { Router, type IRouter } from "express";
import { queryOne, queryMany } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res) => {
  try {
    const where: string[] = ["m.ACTIVE = 1"];
    const params: Record<string, unknown> = {};
    if (req.query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
    if (req.query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(req.query.teamId)); }
    if (req.query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(req.query.pollinationYear)); }
    if (req.query.spCrosses === "true") where.push("v.SP_Crosses = 1");
    const whereClause = `WHERE ${where.join(" AND ")}`;
    const FROM = `FROM dbo.vw_GH_CrossesDesk v INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID`;

    const stats = await queryOne<{
      totalActiveCrosses: number;
      totalShipRequest: number;
      totalShipActual: number;
      totalTransplantsRequired: number;
      totalSeedRequired: number;
      totalPollinationsRequired: number;
    }>(
      `SELECT COUNT(*) AS totalActiveCrosses,
              COALESCE(SUM(v.TOTAL_SEEDLING_SHIP_REQUEST_Calc), 0) AS totalShipRequest,
              COALESCE(SUM(v.Ship_Total_Actual), 0) AS totalShipActual,
              COALESCE(SUM(v.TRANSPLANTS_REQUIRED), 0) AS totalTransplantsRequired,
              COALESCE(SUM(v.SEED_WEIGHT_REQUIRED), 0) AS totalSeedRequired,
              COALESCE(SUM(v.FLOWERS_TO_POLLINATE_REQUIRED), 0) AS totalPollinationsRequired
       ${FROM} ${whereClause}`,
      params,
    );

    const byBerry = await queryMany<{ berry: string | null; count: number }>(
      `SELECT v.Berry AS berry, COUNT(*) AS count ${FROM} ${whereClause} GROUP BY v.Berry`,
      params,
    );

    const pollStats = await queryOne<{
      totalPollReq: number; totalPollDone: number;
      totalSeedReq: number; totalSeedSown: number;
      totalTransReq: number; totalTransDone: number;
    }>(
      `SELECT COALESCE(SUM(v.FLOWERS_TO_POLLINATE_REQUIRED), 0) AS totalPollReq,
              COALESCE(SUM(v.Successful_Pollinations), 0) AS totalPollDone,
              COALESCE(SUM(v.SEED_WEIGHT_REQUIRED), 0) AS totalSeedReq,
              COALESCE(SUM(v.Seed_Weight_Inventory), 0) AS totalSeedSown,
              COALESCE(SUM(v.TRANSPLANTS_REQUIRED), 0) AS totalTransReq,
              COALESCE(SUM(v.Plant_Num_Transplanted), 0) AS totalTransDone
       ${FROM} ${whereClause}`,
      params,
    );

    const s = stats ?? { totalActiveCrosses: 0, totalShipRequest: 0, totalShipActual: 0, totalTransplantsRequired: 0, totalSeedRequired: 0, totalPollinationsRequired: 0 };
    const p = pollStats ?? { totalPollReq: 0, totalPollDone: 0, totalSeedReq: 0, totalSeedSown: 0, totalTransReq: 0, totalTransDone: 0 };

    const stages = [
      { stage: "Pollination", count: p.totalPollDone > 0 ? 1 : 0 },
      { stage: "Seed", count: p.totalSeedSown > 0 ? 1 : 0 },
      { stage: "Transplant", count: p.totalTransDone > 0 ? 1 : 0 },
    ];

    const pollinationProgress = p.totalPollReq > 0 ? Math.round((p.totalPollDone / p.totalPollReq) * 100) : 0;
    const seedProgress = p.totalSeedReq > 0 ? Math.round((p.totalSeedSown / p.totalSeedReq) * 100) : 0;
    const transplantProgress = p.totalTransReq > 0 ? Math.round((p.totalTransDone / p.totalTransReq) * 100) : 0;
    const shipProgress = s.totalShipRequest > 0 ? Math.round((s.totalShipActual / s.totalShipRequest) * 100) : 0;

    res.json({
      totalActiveCrosses: s.totalActiveCrosses,
      crossesByBerry: byBerry.filter((b) => b.berry !== null),
      crossesByStage: stages,
      totalShipRequest: s.totalShipRequest,
      totalTransplantsRequired: s.totalTransplantsRequired,
      totalSeedRequired: s.totalSeedRequired,
      totalPollinationsRequired: s.totalPollinationsRequired,
      pollinationProgress, seedProgress, transplantProgress, shipProgress,
    });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

export default router;
