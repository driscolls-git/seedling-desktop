import { Router, type IRouter, type Request } from "express";
import { queryMany, queryOne, execute } from "@workspace/db";
import { requireBreeder, requireBreederOnly, type AuthenticatedRequest } from "../middleware/auth";
import { CreateParentBody, UpdateParentBody } from "@workspace/api-zod";
import { recalcSeedlingMaster } from "../services/recalc";

const router: IRouter = Router();

function userName(req: Request): string {
  return (req as AuthenticatedRequest).user?.name ?? "system";
}

function toBit(v: unknown): 0 | 1 {
  if (v === true || v === 1 || v === "1" || v === "true") return 1;
  return 0;
}

interface ParentApiRow {
  id: number;
  selection: string | null;
  l1fc: string | null;
  l1: string | null;
  l2fc: string | null;
  l2: string | null;
  l3fc: string | null;
  l3: string | null;
  l4fc: string | null;
  l4: string | null;
  totalParents: number | null;
  totalParentsRequired: number | null;
  hasSufficientParents: boolean;
  flowersRequiredForPollen: number | null;
  totalFlowersCollected: number | null;
  flowersForPollenUsed: number | null;
  badPollen: number | null;
  flowersForPollenAvail: number | null;
  flowersForPollenVariance: number | null;
  pollinationYear: number | null;
  comments: string | null;
  active: boolean;
  berryId: number | null;
  berryName: string | null;
  teamId: number | null;
  teamName: string | null;
  spCrosses: boolean;
  firstYrParent: boolean;
}

// ── GET /parents ─────────────────────────────────────────────
// Drives from vw_GHPollenDesk — the gallery view that exposes the calculated
// Total_Parents_Required, Parent1_Required, Parent2_Required, Parent_Variance,
// etc.  Per-cross totals reflect actual usage in submitted crosses, not just
// the static parent inventory.  We join M_BerryID + M_GHTeams to surface IDs
// so the existing berryId/teamId filter contracts keep working.
router.get("/parents", async (req, res) => {
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
    if (req.query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(req.query.pollinationYear)); }
    if (req.query.spCrosses === "true") { where.push("v.SP_Crosses = 1"); }
    if (req.query.selection) { where.push("v.Selection LIKE @sel"); params.sel = `%${String(req.query.selection)}%`; }
    if (req.query.active === "true") { where.push("v.Active = 1"); }

    const rows = await queryMany<{
      id: number;
      selection: string | null;
      l1fc: string | null; l1: string | null;
      l2fc: string | null; l2: string | null;
      l3fc: string | null; l3: string | null;
      l4fc: string | null; l4: string | null;
      totalParents: number | null;
      totalParentsRequired: number | null;
      parent1Required: number | null;
      parent2Required: number | null;
      parentVariance: number | null;
      flowersRequiredForPollen: number | null;
      totalFlowersCollected: number | null;
      flowersForPollenUsed: number | null;
      badPollen: number | null;
      flowersForPollenAvail: number | null;
      flowersForPollenVariance: number | null;
      pollinationYear: number | null;
      comments: string | null;
      active: boolean | null;
      berryName: string | null; teamName: string | null;
      berryId: number | null; teamId: number | null;
      spCrosses: boolean | null;
      firstYrParent: boolean | null;
      isBadPollenParent: boolean | null;
    }>(
      `SELECT v.GHParentInventory_ID AS id,
              v.Selection AS selection,
              v.L1FC AS l1fc, v.L1 AS l1, v.L2FC AS l2fc, v.L2 AS l2,
              v.L3FC AS l3fc, v.L3 AS l3, v.L4FC AS l4fc, v.L4 AS l4,
              v.Total_Parents AS totalParents,
              v.Total_Parents_Required AS totalParentsRequired,
              v.Parent1_Required AS parent1Required,
              v.Parent2_Required AS parent2Required,
              v.Parent_Variance AS parentVariance,
              v.Total_Flowers_Required_For_Pollen AS flowersRequiredForPollen,
              v.TOTAL_FLOWERS_COLLECTED AS totalFlowersCollected,
              v.FLOWERS_FOR_POLLEN_USED AS flowersForPollenUsed,
              v.BAD_POLLEN AS badPollen,
              v.FLOWERS_FOR_POLLEN_AVAIL AS flowersForPollenAvail,
              v.FLOWERS_FOR_POLLEN_VARIANCE AS flowersForPollenVariance,
              v.Pollination_Year AS pollinationYear,
              v.Comments AS comments,
              v.Active AS active,
              v.Berry AS berryName, v.Team_Name AS teamName,
              b.PK_BerryID AS berryId,
              t.Team_ID AS teamId,
              v.SP_Crosses AS spCrosses,
              v.First_Yr_Parent AS firstYrParent,
              v.Is_Bad_Pollen_Parent AS isBadPollenParent
         FROM dbo.vw_GHPollenDesk v
         LEFT JOIN TPN.dbo.M_BerryID b ON v.Berry = b.BerryType
         LEFT JOIN dbo.M_GHTeams t ON v.Team_Name = t.Team_Name
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY v.Selection`,
      params,
    );

    const response = rows.map((r) => ({
      id: r.id,
      selection: r.selection,
      l1fc: r.l1fc, l1: r.l1, l2fc: r.l2fc, l2: r.l2,
      l3fc: r.l3fc, l3: r.l3, l4fc: r.l4fc, l4: r.l4,
      totalParents: r.totalParents,
      totalParentsRequired: r.totalParentsRequired,
      parent1Required: r.parent1Required,
      parent2Required: r.parent2Required,
      parentVariance: r.parentVariance,
      hasSufficientParents:
        r.totalParents != null && r.totalParentsRequired != null
          ? r.totalParents >= r.totalParentsRequired
          : false,
      flowersRequiredForPollen: r.flowersRequiredForPollen,
      totalFlowersCollected: r.totalFlowersCollected,
      flowersForPollenUsed: r.flowersForPollenUsed,
      badPollen: r.badPollen,
      flowersForPollenAvail: r.flowersForPollenAvail,
      flowersForPollenVariance: r.flowersForPollenVariance,
      pollinationYear: r.pollinationYear,
      comments: r.comments,
      active: r.active === true,
      berryId: r.berryId, berryName: r.berryName,
      teamId: r.teamId, teamName: r.teamName,
      spCrosses: r.spCrosses === true,
      firstYrParent: r.firstYrParent === true,
      isBadPollenParent: r.isBadPollenParent === true,
    }));
    res.json(response);
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── GET /parents/validate ────────────────────────────────────
// Validates that a (selection, berryId) combo exists in master data
// (GIP.dbo.BRD_Selection — the canonical source of approved selections
// per berry).  If WebAppUser lacks access to GIP, falls back to checking
// T_GHParentInventory2 so existing flows still work.
//
// Optional query: teamId — if provided, also requires an existing inventory
// record for the (selection, berryId, teamId) trio (legacy contract).
async function isValidSelectionForBerry(selection: string, berryId: number): Promise<boolean> {
  try {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt
         FROM GIP.dbo.BRD_Selection s
         INNER JOIN TPN.dbo.M_BerryID b ON b.BerryType = s.BerryType
        WHERE s.Selection = @sel AND b.PK_BerryID = @berryId`,
      { sel: selection, berryId },
    );
    return (row?.cnt ?? 0) > 0;
  } catch (err) {
    // Permission denied or DB unreachable — fall back to inventory existence check.
    console.warn("[parents] master selection check failed, falling back:", err instanceof Error ? err.message : err);
    const fallback = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM dbo.T_GHParentInventory2
        WHERE Selection = @sel AND Berry_ID = @berryId`,
      { sel: selection, berryId },
    );
    return (fallback?.cnt ?? 0) > 0;
  }
}

router.get("/parents/validate", async (req, res) => {
  try {
    const selection = String(req.query.selection ?? "");
    const berryId = parseInt(String(req.query.berryId));
    if (!selection || isNaN(berryId)) {
      res.json({ valid: false, message: "selection and berryId are required" });
      return;
    }

    const masterMatch = await isValidSelectionForBerry(selection, berryId);
    if (!masterMatch) {
      res.json({
        valid: false,
        reason: "not_in_master",
        message: "Selection not found in master data for this berry",
      });
      return;
    }

    // teamId provided → also confirm an inventory record (legacy behaviour).
    if (req.query.teamId) {
      const teamId = parseInt(String(req.query.teamId));
      const row = await queryOne<{ id: number }>(
        `SELECT TOP 1 GHParentInventory_ID AS id
           FROM dbo.T_GHParentInventory2
          WHERE Selection = @sel AND Berry_ID = @berryId AND Team_ID = @teamId AND Active = 1`,
        { sel: selection, berryId, teamId },
      );
      if (row) res.json({ valid: true, parentId: row.id });
      else res.json({ valid: false, reason: "no_inventory", message: "No active inventory record for this team" });
      return;
    }

    res.json({ valid: true });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── GET /parents/:id ─────────────────────────────────────────
router.get("/parents/:id", async (req, res) => {
  try {
    const row = await queryOne<{
      id: number;
      selection: string | null;
      l1fc: string | null; l1: string | null; l2fc: string | null; l2: string | null;
      l3fc: string | null; l3: string | null; l4fc: string | null; l4: string | null;
      totalParents: number | null;
      flowersRequiredForPollen: number | null;
      totalFlowersCollected: number | null;
      flowersForPollenUsed: number | null;
      badPollen: number | null;
      flowersForPollenAvail: number | null;
      flowersForPollenVariance: number | null;
      pollinationYear: number | null;
      comments: string | null;
      active: boolean | null;
      berryId: number | null; berryName: string | null;
      teamId: number | null; teamName: string | null;
      spCrosses: boolean | null;
      firstYrParent: number | null;
    }>(
      `SELECT pi.GHParentInventory_ID AS id, pi.Selection AS selection,
              pi.L1FC AS l1fc, pi.L1 AS l1, pi.L2FC AS l2fc, pi.L2 AS l2,
              pi.L3FC AS l3fc, pi.L3 AS l3, pi.L4FC AS l4fc, pi.L4 AS l4,
              pi.Total_Parents AS totalParents,
              pi.FLOWERS_REQUIRED_FOR_POLLEN AS flowersRequiredForPollen,
              pi.TOTAL_FLOWERS_COLLECTED AS totalFlowersCollected,
              pi.FLOWERS_FOR_POLLEN_USED AS flowersForPollenUsed,
              pi.BAD_POLLEN AS badPollen,
              pi.FLOWERS_FOR_POLLEN_AVAIL AS flowersForPollenAvail,
              pi.FLOWERS_FOR_POLLEN_VARIANCE AS flowersForPollenVariance,
              pi.Pollination_Year AS pollinationYear,
              pi.Comments AS comments, pi.Active AS active,
              pi.Berry_ID AS berryId, b.BerryType AS berryName,
              pi.Team_ID AS teamId, t.Team_Name AS teamName,
              pi.SP_Crosses AS spCrosses,
              pi.First_Yr_Parent AS firstYrParent
         FROM dbo.T_GHParentInventory2 pi
         LEFT JOIN TPN.dbo.M_BerryID b ON pi.Berry_ID = b.PK_BerryID
         LEFT JOIN dbo.M_GHTeams t ON pi.Team_ID = t.Team_ID
        WHERE pi.GHParentInventory_ID = @id`,
      { id: parseInt(String(req.params.id)) },
    );
    if (!row) { res.status(404).json({ message: "Parent not found" }); return; }
    res.json({
      id: row.id,
      selection: row.selection,
      l1fc: row.l1fc, l1: row.l1, l2fc: row.l2fc, l2: row.l2,
      l3fc: row.l3fc, l3: row.l3, l4fc: row.l4fc, l4: row.l4,
      totalParents: row.totalParents,
      totalParentsRequired: null,
      hasSufficientParents: false,
      flowersRequiredForPollen: row.flowersRequiredForPollen,
      totalFlowersCollected: row.totalFlowersCollected,
      flowersForPollenUsed: row.flowersForPollenUsed,
      badPollen: row.badPollen,
      flowersForPollenAvail: row.flowersForPollenAvail,
      flowersForPollenVariance: row.flowersForPollenVariance,
      pollinationYear: row.pollinationYear,
      comments: row.comments,
      active: row.active === true,
      berryId: row.berryId, berryName: row.berryName,
      teamId: row.teamId, teamName: row.teamName,
      spCrosses: row.spCrosses === true,
      // Matches vw_GHPollenDesk: 2 → true ("Yes"), 1 (and the 4 legacy 0 rows) → see view CASE.
      firstYrParent: row.firstYrParent === 2,
    });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── POST /parents ────────────────────────────────────────────
router.post("/parents", requireBreeder, async (req, res) => {
  try {
    const body = CreateParentBody.parse(req.body);
    if (!body.pollinationYear) { res.status(400).json({ message: "Pollination Year is required." }); return; }

    // Master-data guard: the (selection, berry) combo must exist in
    // GIP.dbo.BRD_Selection (or fallback to inventory if WebAppUser lacks GIP access).
    const masterMatch = await isValidSelectionForBerry(body.selection, body.berryId);
    if (!masterMatch) {
      res.status(400).json({
        message: "This Selection does not exist in master data for the selected berry. Please verify the Selection and Berry combination.",
      });
      return;
    }

    const dup = await queryOne<{ id: number }>(
      `SELECT TOP 1 GHParentInventory_ID AS id
         FROM dbo.T_GHParentInventory2
        WHERE Selection = @sel AND Berry_ID = @berryId AND Team_ID = @teamId AND Pollination_Year = @py`,
      { sel: body.selection, berryId: body.berryId, teamId: body.teamId ?? null, py: body.pollinationYear },
    );
    if (dup) { res.status(400).json({ message: "This Selection already exists under the same berry, team, and pollination year." }); return; }

    const row = await queryOne<{ id: number }>(
      `INSERT INTO dbo.T_GHParentInventory2
         (Selection, L1FC, L1, L2FC, L2, L3FC, L3, L4FC, L4,
          Total_Parents, Pollination_Year, Comments, Active,
          Berry_ID, Team_ID, SP_Crosses, First_Yr_Parent, CreatedBy, CreatedDateTime)
       OUTPUT INSERTED.GHParentInventory_ID AS id
       VALUES (@sel, @l1fc, @l1, @l2fc, @l2, @l3fc, @l3, @l4fc, @l4,
               @total, @py, @comments, @active,
               @berryId, @teamId, @sp, @firstYr, @user, GETDATE())`,
      {
        sel: body.selection,
        l1fc: body.l1fc ?? null, l1: body.l1 ?? null,
        l2fc: body.l2fc ?? null, l2: body.l2 ?? null,
        l3fc: body.l3fc ?? null, l3: body.l3 ?? null,
        l4fc: body.l4fc ?? null, l4: body.l4 ?? null,
        total: body.totalParents ?? null,
        py: body.pollinationYear,
        comments: body.comments ?? null,
        active: body.active === false ? 0 : 1,
        berryId: body.berryId,
        teamId: body.teamId ?? null,
        sp: toBit(body.spCrosses),
        // First_Yr_Parent is an INT on T_GHParentInventory2 that the recalc
        // proc divides by (see usp_Update_GHSeedlingMaster_Calculations).
        // 1 = established parent (1× flower yield), 2 = first-year parent
        // (half flower yield → needs 2× more parents). vw_GHPollenDesk
        // maps 1 → false ("No"), anything else → true ("Yes"), which is
        // what the Parent Inventory gallery displays.
        firstYr: body.firstYrParent ? 2 : 1,
        user: userName(req),
      },
    );
    // Parent inventory feeds the recalc proc (piv.First_Yr_Parent in the
    // P1/P2_TOTAL_PARENTS_REQUIRED math), so any insert/update/delete on
    // T_GHParentInventory2 should re-fire it for crosses that reference this
    // selection.  The proc runs on every row so a single call covers all.
    await recalcSeedlingMaster();
    res.status(201).json({ id: row!.id });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── PUT /parents/:id ─────────────────────────────────────────
router.put("/parents/:id", requireBreeder, async (req, res) => {
  try {
    const body = UpdateParentBody.parse(req.body);
    const id = parseInt(String(req.params.id));
    if (!body.pollinationYear) { res.status(400).json({ message: "Pollination Year is required." }); return; }

    const dup = await queryOne<{ id: number }>(
      `SELECT TOP 1 GHParentInventory_ID AS id
         FROM dbo.T_GHParentInventory2
        WHERE Selection = @sel AND Berry_ID = @berryId AND Team_ID = @teamId
              AND Pollination_Year = @py AND GHParentInventory_ID <> @id`,
      { id, sel: body.selection, berryId: body.berryId, teamId: body.teamId ?? null, py: body.pollinationYear },
    );
    if (dup) { res.status(400).json({ message: "This Selection already exists under the same berry, team, and pollination year." }); return; }

    await execute(
      `UPDATE dbo.T_GHParentInventory2
          SET Selection = @sel, L1FC = @l1fc, L1 = @l1, L2FC = @l2fc, L2 = @l2,
              L3FC = @l3fc, L3 = @l3, L4FC = @l4fc, L4 = @l4,
              Total_Parents = @total, Pollination_Year = @py,
              Comments = @comments, Active = @active,
              Berry_ID = @berryId, Team_ID = @teamId,
              SP_Crosses = @sp, First_Yr_Parent = @firstYr,
              ModifiedBy = @user, ModifiedDateTime = GETDATE()
        WHERE GHParentInventory_ID = @id`,
      {
        id,
        sel: body.selection,
        l1fc: body.l1fc ?? null, l1: body.l1 ?? null,
        l2fc: body.l2fc ?? null, l2: body.l2 ?? null,
        l3fc: body.l3fc ?? null, l3: body.l3 ?? null,
        l4fc: body.l4fc ?? null, l4: body.l4 ?? null,
        total: body.totalParents ?? null,
        py: body.pollinationYear,
        comments: body.comments ?? null,
        active: body.active === false ? 0 : 1,
        berryId: body.berryId,
        teamId: body.teamId ?? null,
        sp: toBit(body.spCrosses),
        // First_Yr_Parent is an INT on T_GHParentInventory2 that the recalc
        // proc divides by (see usp_Update_GHSeedlingMaster_Calculations).
        // 1 = established parent (1× flower yield), 2 = first-year parent
        // (half flower yield → needs 2× more parents). vw_GHPollenDesk
        // maps 1 → false ("No"), anything else → true ("Yes"), which is
        // what the Parent Inventory gallery displays.
        firstYr: body.firstYrParent ? 2 : 1,
        user: userName(req),
      },
    );
    await recalcSeedlingMaster();
    res.json({ id });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

router.delete("/parents/:id", requireBreederOnly, async (req, res) => {
  await execute(
    `DELETE FROM dbo.T_GHParentInventory2 WHERE GHParentInventory_ID = @id`,
    { id: parseInt(String(req.params.id)) },
  );
  await recalcSeedlingMaster();
  res.status(204).send();
});

export default router;
