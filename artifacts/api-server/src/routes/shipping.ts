import { Router, type IRouter } from "express";
import { queryMany, queryOne, withTransaction } from "@workspace/db";
import { requireBreeder, type AuthenticatedRequest } from "../middleware/auth";

const router: IRouter = Router();

function buildFilters(query: Record<string, unknown>): { where: string; params: Record<string, unknown> } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(query.berryId)); }
  if (query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(query.teamId)); }
  if (query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(query.pollinationYear)); }
  if (query.progeny) { where.push("v.Progeny LIKE @prog"); params.prog = `%${String(query.progeny)}%`; }
  // The view pivots M_GHSeedlingMaster's two destination/program columns into
  // separate rows.  Filter on v.Destination / v.Program (each row's own value)
  // instead of the M_GHSeedlingMaster columns — otherwise selecting one
  // destination returns BOTH pivoted rows of any progeny that has it on either
  // side (the whole progeny matches, dragging in its sibling row).
  if (query.programId) {
    const pids = String(query.programId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (pids.length > 0) {
      const placeholders = pids.map((pid, i) => { params[`prog${i}`] = pid; return `@prog${i}`; });
      where.push(`v.Program IN (SELECT SrcBreedingProgram FROM TPN.dbo.M_SrcBreedingProgram WHERE SrcBreedingProgramId IN (${placeholders.join(",")}))`);
    }
  }
  if (query.destinationId) {
    const dids = String(query.destinationId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (dids.length > 0) {
      const placeholders = dids.map((did, i) => { params[`dest${i}`] = did; return `@dest${i}`; });
      where.push(`v.Destination IN (SELECT LocationName FROM TPN.dbo.M_Locations WHERE Location_ID IN (${placeholders.join(",")}))`);
    }
  }
  if (query.shipped === "true") where.push("v.Shipped = 1");
  if (query.shipped === "false") where.push("v.Shipped = 0");
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const FROM = `
  FROM dbo.vw_GH_Destination_Shipping v
  INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID`;

router.get("/shipping", async (req, res) => {
  try {
    const page = parseInt(String(req.query.page)) || 1;
    const pageSize = Math.min(parseInt(String(req.query.pageSize)) || 25, 5000);
    const offset = (page - 1) * pageSize;
    const { where, params } = buildFilters(req.query as Record<string, unknown>);

    const countRow = await queryOne<{ total: number }>(`SELECT COUNT(*) AS total ${FROM} ${where}`, params);
    const total = countRow?.total ?? 0;

    const rows = await queryMany<Record<string, unknown>>(
      `SELECT v.GHSeedlingMaster_ID AS id, v.Progeny AS progeny,
              v.Destination AS destination, v.Program AS program,
              v.Ship_Request AS shipRequest,
              v.Sort_Group_1 AS sortGroup1, v.Sort_Group_2 AS sortGroup2, v.Sort_Group_3 AS sortGroup3,
              v.Sort_Group_4 AS sortGroup4, v.Sort_Group_5 AS sortGroup5,
              v.Total_Sort_Group AS totalShipPlan, v.Ship_Total_Actual AS shipTotalActual,
              v.First_Tray_Box AS firstTrayBox, v.Last_Tray_Box AS lastTrayBox,
              v.Rack_Pallet AS rackPallet, v.Extras_Not_Shipped AS extrasNotShipped,
              v.Comments AS comments, v.Ship_Created_Date AS shipCreatedDate, v.Shipped AS shipped,
              v.Berry AS berry, m.Berry_ID AS berryId,
              v.Team_Name AS teamName, m.Team_ID AS teamId,
              v.Pollination_Year AS pollinationYear
       ${FROM} ${where}
       ORDER BY v.Progeny
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize },
    );
    res.json({
      data: rows.map((r) => ({
        ...r,
        shipCreatedDate: r.shipCreatedDate instanceof Date ? r.shipCreatedDate.toISOString() : null,
        shipped: r.shipped === true,
      })),
      total, page, pageSize, totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

router.get("/shipping/totals", async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query as Record<string, unknown>);
    const row = await queryOne<Record<string, number>>(
      `SELECT COUNT(*) AS [rowCount],
              COALESCE(SUM(v.Ship_Request), 0) AS shipRequest,
              COALESCE(SUM(v.Sort_Group_1), 0) AS sortGroup1,
              COALESCE(SUM(v.Sort_Group_2), 0) AS sortGroup2,
              COALESCE(SUM(v.Sort_Group_3), 0) AS sortGroup3,
              COALESCE(SUM(v.Sort_Group_4), 0) AS sortGroup4,
              COALESCE(SUM(v.Sort_Group_5), 0) AS sortGroup5,
              COALESCE(SUM(v.Ship_Total_Actual), 0) AS shipTotalActual,
              COALESCE(SUM(v.Extras_Not_Shipped), 0) AS extrasNotShipped
       ${FROM} ${where}`,
      params,
    );
    res.json(row ?? {});
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

router.get("/shipping/destinations", async (_req, res) => {
  try {
    const rows = await queryMany<{ destination: string | null }>(
      `SELECT DISTINCT Destination AS destination FROM dbo.vw_GH_Destination_Shipping WHERE Destination IS NOT NULL ORDER BY Destination`,
    );
    res.json(rows.map((r) => r.destination));
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── Sort Group Allocation ─────────────────────────────────────────────
//
// Per-progeny, per-destination (D1/D2) allocation of Sort_Group_1..5 counts.
// Source-of-truth totals come from vw_GH_MarkerProgenyDesk (computed from
// T_GHMarkerDiscards). The persisted splits live in T_GHSortGroupAllocation
// (one row per (ghsm_FK, Destination_Type) where Destination_Type IN ('D1','D2')).
//
// See SORT_GROUP_ALLOCATION_DESIGN.md for the full design and the migration
// at db-migrations/2026-05-21-sort-group-allocation.sql.

router.get("/shipping/allocation", async (req, res) => {
  try {
    const where: string[] = ["sm.ACTIVE = 1", "mp.D2_Program IS NOT NULL"];
    const params: Record<string, unknown> = {};
    if (req.query.berryId)         { where.push("sm.Berry_ID = @berryId");        params.berryId = parseInt(String(req.query.berryId)); }
    if (req.query.teamId)          { where.push("sm.Team_ID = @teamId");          params.teamId  = parseInt(String(req.query.teamId)); }
    if (req.query.pollinationYear) { where.push("mp.Pollination_Year = @py");     params.py      = parseInt(String(req.query.pollinationYear)); }
    if (req.query.progeny)         { where.push("mp.Progeny LIKE @prog");         params.prog    = `%${String(req.query.progeny)}%`; }
    if (req.query.program) {
      where.push("(mp.D1_Program LIKE @program OR mp.D2_Program LIKE @program)");
      params.program = `%${String(req.query.program)}%`;
    }
    // Only progenies whose source-of-truth Sort_Group counts add up to > 0 —
    // i.e. there's actually something to allocate. Matches the original
    // Drizzle filter in the package.
    where.push(
      "(COALESCE(mp.Sort_Group1,0) + COALESCE(mp.Sort_Group2,0) + COALESCE(mp.Sort_Group3,0) + COALESCE(mp.Sort_Group4,0) + COALESCE(mp.Sort_Group5,0)) > 0"
    );

    const rows = await queryMany<{
      ghsmId: number;
      progeny: string | null;
      berry: string | null;
      teamName: string | null;
      pollinationYear: number | null;
      sortGroup1: number | null;
      sortGroup2: number | null;
      sortGroup3: number | null;
      sortGroup4: number | null;
      sortGroup5: number | null;
      d1Destination: string | null;
      d1Program: string | null;
      d1ShipRequest: number | null;
      d1Sg1: number | null; d1Sg2: number | null; d1Sg3: number | null; d1Sg4: number | null; d1Sg5: number | null;
      d2Destination: string | null;
      d2Program: string | null;
      d2ShipRequest: number | null;
      d2Sg1: number | null; d2Sg2: number | null; d2Sg3: number | null; d2Sg4: number | null; d2Sg5: number | null;
    }>(
      `SELECT
         mp.GHSeedlingMaster_ID AS ghsmId,
         mp.Progeny AS progeny,
         mp.Berry AS berry,
         mp.Team_Name AS teamName,
         mp.Pollination_Year AS pollinationYear,
         COALESCE(mp.Sort_Group1, 0) AS sortGroup1,
         COALESCE(mp.Sort_Group2, 0) AS sortGroup2,
         COALESCE(mp.Sort_Group3, 0) AS sortGroup3,
         COALESCE(mp.Sort_Group4, 0) AS sortGroup4,
         COALESCE(mp.Sort_Group5, 0) AS sortGroup5,
         ds1.Destination AS d1Destination,
         mp.D1_Program   AS d1Program,
         COALESCE(ds1.Ship_Request, 0) AS d1ShipRequest,
         COALESCE(a1.Sort_Group_1, 0) AS d1Sg1,
         COALESCE(a1.Sort_Group_2, 0) AS d1Sg2,
         COALESCE(a1.Sort_Group_3, 0) AS d1Sg3,
         COALESCE(a1.Sort_Group_4, 0) AS d1Sg4,
         COALESCE(a1.Sort_Group_5, 0) AS d1Sg5,
         ds2.Destination AS d2Destination,
         mp.D2_Program   AS d2Program,
         COALESCE(ds2.Ship_Request, 0) AS d2ShipRequest,
         COALESCE(a2.Sort_Group_1, 0) AS d2Sg1,
         COALESCE(a2.Sort_Group_2, 0) AS d2Sg2,
         COALESCE(a2.Sort_Group_3, 0) AS d2Sg3,
         COALESCE(a2.Sort_Group_4, 0) AS d2Sg4,
         COALESCE(a2.Sort_Group_5, 0) AS d2Sg5
       FROM dbo.vw_GH_MarkerProgenyDesk mp
       INNER JOIN dbo.M_GHSeedlingMaster sm ON sm.GHSeedlingMaster_ID = mp.GHSeedlingMaster_ID
       LEFT JOIN dbo.vw_GH_Destination_Shipping ds1
              ON ds1.GHSeedlingMaster_ID = mp.GHSeedlingMaster_ID AND ds1.Destination_Type = 'D1'
       LEFT JOIN dbo.vw_GH_Destination_Shipping ds2
              ON ds2.GHSeedlingMaster_ID = mp.GHSeedlingMaster_ID AND ds2.Destination_Type = 'D2'
       LEFT JOIN dbo.T_GHSortGroupAllocation a1
              ON a1.ghsm_FK = mp.GHSeedlingMaster_ID AND a1.Destination_Type = 'D1'
       LEFT JOIN dbo.T_GHSortGroupAllocation a2
              ON a2.ghsm_FK = mp.GHSeedlingMaster_ID AND a2.Destination_Type = 'D2'
       WHERE ${where.join(" AND ")}
       ORDER BY mp.Progeny`,
      params,
    );

    res.json({
      data: rows.map((r) => ({
        ghsmId: r.ghsmId,
        progeny: r.progeny,
        berry: r.berry,
        teamName: r.teamName,
        pollinationYear: r.pollinationYear,
        sortGroup1: r.sortGroup1 ?? 0,
        sortGroup2: r.sortGroup2 ?? 0,
        sortGroup3: r.sortGroup3 ?? 0,
        sortGroup4: r.sortGroup4 ?? 0,
        sortGroup5: r.sortGroup5 ?? 0,
        d1: {
          destination: r.d1Destination,
          program: r.d1Program,
          shipRequest: r.d1ShipRequest ?? 0,
          sortGroup1: r.d1Sg1 ?? 0,
          sortGroup2: r.d1Sg2 ?? 0,
          sortGroup3: r.d1Sg3 ?? 0,
          sortGroup4: r.d1Sg4 ?? 0,
          sortGroup5: r.d1Sg5 ?? 0,
        },
        d2: {
          destination: r.d2Destination,
          program: r.d2Program,
          shipRequest: r.d2ShipRequest ?? 0,
          sortGroup1: r.d2Sg1 ?? 0,
          sortGroup2: r.d2Sg2 ?? 0,
          sortGroup3: r.d2Sg3 ?? 0,
          sortGroup4: r.d2Sg4 ?? 0,
          sortGroup5: r.d2Sg5 ?? 0,
        },
      })),
    });
  } catch (error: unknown) {
    console.error("GET /api/shipping/allocation error:", error);
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

function toNonNegInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

router.patch("/shipping/allocation", requireBreeder, async (req, res) => {
  try {
    const { updates } = req.body ?? {};
    if (!Array.isArray(updates)) {
      res.status(400).json({ message: "updates must be an array" });
      return;
    }

    type Side = { sortGroup1: number; sortGroup2: number; sortGroup3: number; sortGroup4: number; sortGroup5: number };
    type Item = { ghsmId: number; d1: Side; d2: Side };

    const items: Item[] = [];
    for (const raw of updates) {
      const ghsmId = Number(raw?.ghsmId);
      if (!Number.isInteger(ghsmId) || ghsmId <= 0) continue;
      const d1 = raw?.d1 ?? {};
      const d2 = raw?.d2 ?? {};
      items.push({
        ghsmId,
        d1: {
          sortGroup1: toNonNegInt(d1.sortGroup1),
          sortGroup2: toNonNegInt(d1.sortGroup2),
          sortGroup3: toNonNegInt(d1.sortGroup3),
          sortGroup4: toNonNegInt(d1.sortGroup4),
          sortGroup5: toNonNegInt(d1.sortGroup5),
        },
        d2: {
          sortGroup1: toNonNegInt(d2.sortGroup1),
          sortGroup2: toNonNegInt(d2.sortGroup2),
          sortGroup3: toNonNegInt(d2.sortGroup3),
          sortGroup4: toNonNegInt(d2.sortGroup4),
          sortGroup5: toNonNegInt(d2.sortGroup5),
        },
      });
    }

    if (items.length === 0) {
      res.json({ updatedCount: 0 });
      return;
    }

    // Validate: for every (ghsmId, sortGroupN) the proposed D1 + D2 split
    // must not exceed the source-of-truth total from vw_GH_MarkerProgenyDesk.
    // Allow under-allocation (mirrors the Extras_Not_Shipped pattern) but
    // reject over-allocation.
    const ids = items.map((i) => i.ghsmId);
    const idPlaceholders = ids.map((_, i) => `@id${i}`).join(",");
    const idParams: Record<string, unknown> = {};
    ids.forEach((id, i) => { idParams[`id${i}`] = id; });

    const totals = await queryMany<{
      ghsmId: number;
      sg1: number | null; sg2: number | null; sg3: number | null; sg4: number | null; sg5: number | null;
    }>(
      `SELECT GHSeedlingMaster_ID AS ghsmId,
              Sort_Group1 AS sg1, Sort_Group2 AS sg2, Sort_Group3 AS sg3,
              Sort_Group4 AS sg4, Sort_Group5 AS sg5
         FROM dbo.vw_GH_MarkerProgenyDesk
        WHERE GHSeedlingMaster_ID IN (${idPlaceholders})`,
      idParams,
    );
    const totalsById = new Map<number, { sg1: number; sg2: number; sg3: number; sg4: number; sg5: number }>();
    for (const t of totals) {
      totalsById.set(t.ghsmId, {
        sg1: t.sg1 ?? 0, sg2: t.sg2 ?? 0, sg3: t.sg3 ?? 0, sg4: t.sg4 ?? 0, sg5: t.sg5 ?? 0,
      });
    }
    const violations: Array<{ ghsmId: number; sortGroup: number; d1: number; d2: number; total: number }> = [];
    for (const it of items) {
      const t = totalsById.get(it.ghsmId);
      if (!t) {
        violations.push({ ghsmId: it.ghsmId, sortGroup: 0, d1: 0, d2: 0, total: 0 });
        continue;
      }
      const tot = [t.sg1, t.sg2, t.sg3, t.sg4, t.sg5];
      const d1s = [it.d1.sortGroup1, it.d1.sortGroup2, it.d1.sortGroup3, it.d1.sortGroup4, it.d1.sortGroup5];
      const d2s = [it.d2.sortGroup1, it.d2.sortGroup2, it.d2.sortGroup3, it.d2.sortGroup4, it.d2.sortGroup5];
      for (let n = 0; n < 5; n++) {
        if (d1s[n] + d2s[n] > tot[n]) {
          violations.push({ ghsmId: it.ghsmId, sortGroup: n + 1, d1: d1s[n], d2: d2s[n], total: tot[n] });
        }
      }
    }
    if (violations.length > 0) {
      res.status(400).json({
        message: "Split exceeds source total for one or more (progeny, sort group). Adjust priorities so D1 + D2 <= total per Sort Group.",
        violations: violations.slice(0, 20), // cap to avoid huge payloads
      });
      return;
    }

    // Upsert each side via MERGE inside a single transaction so a failure
    // mid-batch rolls back the whole save.
    const user = (req as AuthenticatedRequest).user?.name ?? "system";
    let updatedCount = 0;

    await withTransaction(async (tx) => {
      for (const it of items) {
        for (const side of (['D1', 'D2'] as const)) {
          const s = it[side === 'D1' ? 'd1' : 'd2'];
          await tx.execute(
            `MERGE dbo.T_GHSortGroupAllocation AS target
               USING (SELECT @ghsm AS ghsm_FK, @destType AS Destination_Type) AS src
                  ON target.ghsm_FK = src.ghsm_FK AND target.Destination_Type = src.Destination_Type
             WHEN MATCHED THEN
               UPDATE SET Sort_Group_1 = @sg1, Sort_Group_2 = @sg2, Sort_Group_3 = @sg3,
                          Sort_Group_4 = @sg4, Sort_Group_5 = @sg5,
                          Modified_By = @user, Modified_DateTime = GETDATE()
             WHEN NOT MATCHED THEN
               INSERT (ghsm_FK, Destination_Type, Sort_Group_1, Sort_Group_2, Sort_Group_3, Sort_Group_4, Sort_Group_5, Created_By)
               VALUES (@ghsm, @destType, @sg1, @sg2, @sg3, @sg4, @sg5, @user);`,
            {
              ghsm: it.ghsmId,
              destType: side,
              sg1: s.sortGroup1,
              sg2: s.sortGroup2,
              sg3: s.sortGroup3,
              sg4: s.sortGroup4,
              sg5: s.sortGroup5,
              user,
            },
          );
          updatedCount++;
        }
      }
    });

    res.json({ updatedCount });
  } catch (error: unknown) {
    console.error("PATCH /api/shipping/allocation error:", error);
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

export default router;
