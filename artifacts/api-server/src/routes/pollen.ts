import { Router, type IRouter } from "express";
import { queryMany } from "@workspace/db";

const router: IRouter = Router();

// GET /pollen drives the Pollen List page.  Source = vw_GHPollenDesk so the
// aggregated/calculated columns reflect the actual cross usage:
//   Total_Flowers_Required_For_Pollen  (decimal — Σ across crosses, NOT the
//                                       static FLOWERS_REQUIRED_FOR_POLLEN
//                                       column on T_GHParentInventory2)
//   FLOWERS_FOR_POLLEN_VARIANCE        (calculated)
// L1-L4 are alphanumeric position codes (varchar) — never coerce to numbers.
router.get("/pollen", async (req, res) => {
  try {
    const where: string[] = ["v.Active = 1"];
    const params: Record<string, unknown> = {};
    if (req.query.berryId) {
      where.push("v.Berry = (SELECT BerryType FROM TPN.dbo.M_BerryID WHERE PK_BerryID = @berryId)");
      params.berryId = parseInt(String(req.query.berryId));
    }
    if (req.query.teamId) {
      where.push("v.Team_Name = (SELECT Team_Name FROM dbo.M_GHTeams WHERE Team_ID = @teamId)");
      params.teamId = parseInt(String(req.query.teamId));
    }
    if (req.query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(req.query.pollinationYear)); }
    if (req.query.spCrosses === "true") where.push("v.SP_Crosses = 1");
    if (req.query.selection) { where.push("v.Selection LIKE @sel"); params.sel = `%${String(req.query.selection)}%`; }
    if (req.query.pollenToGo === "true") where.push("COALESCE(v.FLOWERS_FOR_POLLEN_VARIANCE, 0) > 0");

    const rows = await queryMany<{
      id: number;
      selection: string | null;
      berry: string | null;
      teamName: string | null;
      l1fc: string | null; l1: string | null;
      l2fc: string | null; l2: string | null;
      l3fc: string | null; l3: string | null;
      l4fc: string | null; l4: string | null;
      totalParents: number | null;
      totalFlowersRequiredForPollen: number | null;
      totalFlowersCollected: number | null;
      flowersForPollenUsed: number | null;
      badPollen: number | null;
      flowersForPollenAvail: number | null;
      flowersForPollenVariance: number | null;
      pollinationYear: number | null;
      comments: string | null;
      spCrosses: boolean | null;
    }>(
      `SELECT v.GHParentInventory_ID AS id, v.Selection AS selection,
              v.Berry AS berry, v.Team_Name AS teamName,
              v.L1FC AS l1fc, v.L1 AS l1, v.L2FC AS l2fc, v.L2 AS l2,
              v.L3FC AS l3fc, v.L3 AS l3, v.L4FC AS l4fc, v.L4 AS l4,
              v.Total_Parents AS totalParents,
              v.Total_Flowers_Required_For_Pollen AS totalFlowersRequiredForPollen,
              v.TOTAL_FLOWERS_COLLECTED AS totalFlowersCollected,
              v.FLOWERS_FOR_POLLEN_USED AS flowersForPollenUsed,
              v.BAD_POLLEN AS badPollen,
              v.FLOWERS_FOR_POLLEN_AVAIL AS flowersForPollenAvail,
              v.FLOWERS_FOR_POLLEN_VARIANCE AS flowersForPollenVariance,
              v.Pollination_Year AS pollinationYear,
              v.Comments AS comments,
              v.SP_Crosses AS spCrosses
         FROM dbo.vw_GHPollenDesk v
        WHERE ${where.join(" AND ")}
        ORDER BY v.Selection`,
      params,
    );
    res.json(rows.map((r) => ({ ...r, spCrosses: r.spCrosses === true })));
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

export default router;
