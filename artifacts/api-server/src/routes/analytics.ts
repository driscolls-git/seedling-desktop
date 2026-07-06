import { Router, type IRouter } from "express";
import { queryMany } from "@workspace/db";

const router: IRouter = Router();

// Common filter builder for cross-based analytics (vw_GH_CrossesDesk).
function buildCrossFilters(query: Record<string, unknown>, extraClauses: string[] = []): { where: string; params: Record<string, unknown> } {
  const where: string[] = ["m.ACTIVE = 1", ...extraClauses];
  const params: Record<string, unknown> = {};
  if (query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(query.berryId)); }
  if (query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(query.teamId)); }
  if (query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(query.pollinationYear)); }
  if (query.spCrosses === "true") where.push("v.SP_Crosses = 1");
  if (query.programId) { where.push("(m.D1_PROGRAM_FK = @progId OR m.D2_PROGRAM_FK = @progId)"); params.progId = parseInt(String(query.programId)); }
  return { where: `WHERE ${where.join(" AND ")}`, params };
}

const CROSS_FROM = `
  FROM dbo.vw_GH_CrossesDesk v
  INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID`;

type GroupByKey = "program" | "destination" | "team" | "year" | "berry";

const CROSS_GROUP_COLS: Record<GroupByKey, string> = {
  program: "v.D1_Program",
  destination: "v.DESTINATION1",
  team: "v.Team_Name",
  year: "v.Pollination_Year",
  berry: "v.Berry",
};

function genericAnalytics(opts: {
  requiredCol: string;
  doneCol: string;
  capCol?: string;
}) {
  return async (req: any, res: any) => {
    try {
      const groupBy = (req.query.groupBy as GroupByKey) || "program";
      const capExtras = req.query.capExtras === "true";
      const { where, params } = buildCrossFilters(req.query);
      const groupCol = CROSS_GROUP_COLS[groupBy] || CROSS_GROUP_COLS.program;

      const doneExpr = capExtras && opts.capCol
        ? `COALESCE(SUM(CASE WHEN COALESCE(${opts.doneCol}, 0) > COALESCE(${opts.capCol}, 0) THEN COALESCE(${opts.capCol}, 0) ELSE COALESCE(${opts.doneCol}, 0) END), 0)`
        : `COALESCE(SUM(${opts.doneCol}), 0)`;

      const rows = await queryMany<{ [k: string]: unknown; required: number; done: number }>(
        `SELECT ${groupCol} AS [group],
                COALESCE(SUM(${opts.requiredCol}), 0) AS required,
                ${doneExpr} AS done
         ${CROSS_FROM} ${where}
         GROUP BY ${groupCol}
         ORDER BY ${groupCol}`,
        params,
      );
      res.json(
        rows.filter((r) => r.group != null).map((r) => ({
          group: String(r.group), required: Number(r.required), done: Number(r.done),
        })),
      );
    } catch (error: unknown) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
    }
  };
}

router.get("/analytics/pollination", genericAnalytics({
  requiredCol: "v.FLOWERS_TO_POLLINATE_REQUIRED",
  doneCol: "v.Successful_Pollinations",
  capCol: "v.FLOWERS_TO_POLLINATE_REQUIRED",
}));

router.get("/analytics/seed", genericAnalytics({
  requiredCol: "v.SEED_WEIGHT_REQUIRED",
  doneCol: "v.Seed_Weight_Inventory",
  capCol: "v.SEED_WEIGHT_REQUIRED",
}));

router.get("/analytics/transplant", genericAnalytics({
  requiredCol: "v.TRANSPLANTS_REQUIRED",
  doneCol: "v.Plant_Num_Transplanted",
  capCol: "v.TRANSPLANTS_REQUIRED",
}));

// ── Ship analytics (different source: vw_GH_Destination_Shipping) ──

const SHIP_GROUP_COLS: Record<GroupByKey, string> = {
  program: "v.Program",
  destination: "v.Destination",
  team: "v.Team_Name",
  year: "v.Pollination_Year",
  berry: "v.Berry",
};

router.get("/analytics/ship", async (req, res) => {
  try {
    const groupBy = (req.query.groupBy as GroupByKey) || "program";
    const capExtras = req.query.capExtras === "true";
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (req.query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
    if (req.query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(req.query.teamId)); }
    if (req.query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(req.query.pollinationYear)); }
    if (req.query.spCrosses === "true") where.push("v.SP_Crosses = 1");
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const groupCol = SHIP_GROUP_COLS[groupBy] || SHIP_GROUP_COLS.program;

    const doneExpr = capExtras
      ? `COALESCE(SUM(CASE WHEN COALESCE(v.Ship_Total_Actual, 0) > COALESCE(v.Ship_Request, 0) THEN COALESCE(v.Ship_Request, 0) ELSE COALESCE(v.Ship_Total_Actual, 0) END), 0)`
      : `COALESCE(SUM(v.Ship_Total_Actual), 0)`;

    const rows = await queryMany<{ group: string | number | null; required: number; done: number }>(
      `SELECT ${groupCol} AS [group],
              COALESCE(SUM(v.Ship_Request), 0) AS required,
              ${doneExpr} AS done
       FROM dbo.vw_GH_Destination_Shipping v
       INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
       ${whereClause}
       GROUP BY ${groupCol}
       ORDER BY ${groupCol}`,
      params,
    );
    res.json(
      rows.filter((r) => r.group != null).map((r) => ({
        group: String(r.group), required: Number(r.required), done: Number(r.done),
      })),
    );
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── Markers analytics (allocation + crosses-based demand + actuals) ──

type MarkerGroupByKey = "program" | "berry" | "team" | "year";

router.get("/analytics/markers", async (req, res) => {
  try {
    const groupBy = (req.query.groupBy as MarkerGroupByKey) || "program";
    const metric = req.query.metric === "cost" ? "cost" : "sample";
    // Source: dbo.vw_GHMarkerAllocVsAct exposes pre-joined Allocation / Cross /
    // Actual totals by Sample and Cost.  Toggle picks which 3 columns to read.
    const colPrefix = metric === "cost" ? "Marker_Cost" : "Marker_Sample";

    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (req.query.berryId) { where.push("Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
    if (req.query.teamId) { where.push("Team_ID = @teamId"); params.teamId = parseInt(String(req.query.teamId)); }
    if (req.query.pollinationYear) { where.push("Pollination_Year = @py"); params.py = parseInt(String(req.query.pollinationYear)); }
    if (req.query.programId) { where.push("Program_ID = @progId"); params.progId = parseInt(String(req.query.programId)); }
    if (req.query.labId) { where.push("GHLab_ID = @labId"); params.labId = parseInt(String(req.query.labId)); }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const groupColMap: Record<MarkerGroupByKey, string> = {
      program: "Program_Name",
      berry: "Berry",
      team: "GHTeam",
      year: "Pollination_Year",
    };
    const groupCol = groupColMap[groupBy];

    const rows = await queryMany<{ group: string | number | null; allocation: number; crossList: number; actual: number }>(
      `SELECT ${groupCol} AS [group],
              COALESCE(SUM(${colPrefix}_Allocation_Total), 0) AS allocation,
              COALESCE(SUM(${colPrefix}_Cross_Total), 0) AS crossList,
              COALESCE(SUM(${colPrefix}_Actual_Total), 0) AS actual
         FROM dbo.vw_GHMarkerAllocVsAct
         ${whereClause}
        GROUP BY ${groupCol}`,
      params,
    );
    res.json(
      rows
        .filter((r) => r.group != null)
        .map((r) => ({
          group: String(r.group),
          allocation: Number(r.allocation),
          crossList: Number(r.crossList),
          actual: Number(r.actual),
        }))
        .sort((a, b) => a.group.localeCompare(b.group)),
    );
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── Markers planned by type (unpivots marker1..6 columns) ──

router.get("/analytics/markers-planned-by-type", async (req, res) => {
  try {
    const { where, params } = buildCrossFilters(req.query);
    if (req.query.labId) {
      // Filter by testing_lab_1 name (via JOIN)
      params.labId = parseInt(String(req.query.labId));
    }
    const labJoin = req.query.labId
      ? ` AND v.Testing_Lab_1 = (SELECT Lab_Name FROM dbo.M_GHLabs WHERE GHLab_ID = @labId)`
      : "";
    const rows = await queryMany<{
      marker1: string | null; marker2: string | null; marker3: string | null;
      marker4: string | null; marker5: string | null; marker6: string | null;
      transplantsRequired: number | null;
    }>(
      `SELECT v.Marker_1 AS marker1, v.Marker_2 AS marker2, v.Marker_3 AS marker3,
              v.Marker_4 AS marker4, v.Marker_5 AS marker5, v.Marker_6 AS marker6,
              v.TRANSPLANTS_REQUIRED AS transplantsRequired
       ${CROSS_FROM} ${where}${labJoin}`,
      params,
    );
    const totals = new Map<string, number>();
    for (const row of rows) {
      const qty = Number(row.transplantsRequired || 0);
      if (qty <= 0) continue;
      for (const m of [row.marker1, row.marker2, row.marker3, row.marker4, row.marker5, row.marker6]) {
        if (m && m.trim()) {
          const n = m.trim();
          totals.set(n, (totals.get(n) || 0) + qty);
        }
      }
    }
    res.json(Array.from(totals.entries()).map(([group, planned]) => ({ group, planned })).sort((a, b) => b.planned - a.planned));
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── Parents seed-weight per fruit (uses cross view) ──

router.get("/analytics/parents/seed-weight", async (req, res) => {
  try {
    const gender = (req.query.gender as string) || "female";
    const { where, params } = buildCrossFilters(req.query);
    const parentCol = gender === "male"
      ? "CASE WHEN COALESCE(CAST(v.Reciprocal_Done AS INT), 0) = 1 THEN v.PARENT1 ELSE v.PARENT2 END"
      : "CASE WHEN COALESCE(CAST(v.Reciprocal_Done AS INT), 0) = 1 THEN v.PARENT2 ELSE v.PARENT1 END";
    const rows = await queryMany<{ group: string | null; totalSeedWeight: number; totalFruit: number }>(
      `SELECT ${parentCol} AS [group],
              COALESCE(SUM(v.Seed_Weight_Inventory), 0) AS totalSeedWeight,
              COALESCE(SUM(v.Total_Fruit_Collected), 0) AS totalFruit
       ${CROSS_FROM} ${where}
       GROUP BY ${parentCol}
       HAVING SUM(v.Total_Fruit_Collected) > 0`,
      params,
    );
    res.json(rows
      .filter((r) => r.group != null)
      .map((r) => ({ group: r.group, value: Number((Number(r.totalSeedWeight) / Number(r.totalFruit)).toFixed(4)) }))
      .sort((a, b) => b.value - a.value),
    );
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── Parents fruit-pct (uses fruit view) ──

router.get("/analytics/parents/fruit-pct", async (req, res) => {
  try {
    const gender = (req.query.gender as string) || "female";
    const where: string[] = ["m.ACTIVE = 1"];
    const params: Record<string, unknown> = {};
    if (req.query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
    if (req.query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(req.query.teamId)); }
    if (req.query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(req.query.pollinationYear)); }
    if (req.query.spCrosses === "true") where.push("v.SP_Crosses = 1");
    const parentCol = gender === "male"
      ? "CASE WHEN COALESCE(CAST(v.Reciprocal_Done AS INT), 0) = 1 THEN v.PARENT1 ELSE v.PARENT2 END"
      : "CASE WHEN COALESCE(CAST(v.Reciprocal_Done AS INT), 0) = 1 THEN v.PARENT2 ELSE v.PARENT1 END";
    const rows = await queryMany<{ group: string | null; totalFruit: number; totalPollinations: number }>(
      `SELECT ${parentCol} AS [group],
              COALESCE(SUM(v.Total_Fruit_Collected), 0) AS totalFruit,
              COALESCE(SUM(v.Pollination_Qty), 0) AS totalPollinations
         FROM dbo.vw_GH_FruitDesk v
         INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
        WHERE ${where.join(" AND ")}
        GROUP BY ${parentCol}
        HAVING SUM(v.Pollination_Qty) > 0`,
      params,
    );
    res.json(rows
      .filter((r) => r.group != null)
      .map((r) => ({ group: r.group, value: Number(((Number(r.totalFruit) / Number(r.totalPollinations)) * 100).toFixed(1)) }))
      .sort((a, b) => b.value - a.value),
    );
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

export default router;
