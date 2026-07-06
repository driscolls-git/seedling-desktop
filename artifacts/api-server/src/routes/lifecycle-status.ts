import { Router, type IRouter } from "express";
import { queryMany, queryOne, execute } from "@workspace/db";
import { type AuthenticatedRequest, requireAdmin } from "../middleware/auth";

const router: IRouter = Router();

const STEP_COLUMN_MAP: Record<string, string> = {
  pollenDone: "Pollen_Done",
  pollinationDone: "Pollination_Done",
  fruitDone: "Fruit_Done",
  seedDone: "Seed_Done",
  transplantDone: "Transplant_Done",
  screenDone: "Screen_Done",
  shipDone: "Ship_Done",
};

router.get("/lifecycle-status", async (_req, res) => {
  try {
    const summaryRows = await queryMany<{
      berry: string; team_name: string; pollination_year: number; progeny_count: number;
      berry_id: number | null; team_id: number | null; sp_crosses: number;
    }>(
      `SELECT v.Berry AS berry, v.Team_Name AS team_name, v.Pollination_Year AS pollination_year,
              COUNT(*) AS progeny_count,
              MAX(m.Berry_ID) AS berry_id,
              MAX(m.Team_ID) AS team_id,
              MAX(CAST(v.SP_Crosses AS INT)) AS sp_crosses
         FROM dbo.vw_GH_CrossesDesk v
         INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
        WHERE v.Active = 1
        GROUP BY v.Berry, v.Team_Name, v.Pollination_Year
        ORDER BY v.Pollination_Year DESC, v.Berry, v.Team_Name`,
    );

    const statusRows = await queryMany<{
      LifecycleStatus_ID: number; Berry_ID: string; Team_ID: number; Pollination_Year: number | null;
      Pollen_Done: boolean | null; Pollination_Done: boolean | null; Fruit_Done: boolean | null;
      Seed_Done: boolean | null; Transplant_Done: boolean | null;
      Screen_Done: boolean | null; Ship_Done: boolean | null;
      Modified_By: string | null; Modified_DateTime: Date;
    }>(
      `SELECT LifecycleStatus_ID, Berry_ID, Team_ID, Pollination_Year,
              Pollen_Done, Pollination_Done, Fruit_Done, Seed_Done,
              Transplant_Done, Screen_Done, Ship_Done, Modified_By, Modified_DateTime
         FROM dbo.T_GHLifecycleStatus`,
    );
    // Status rows use IDs — build lookup by composite (Berry_ID, Team_ID, Year).
    const statusByIds = new Map<string, (typeof statusRows)[number]>();
    for (const s of statusRows) {
      statusByIds.set(`${s.Berry_ID}||${s.Team_ID}||${s.Pollination_Year}`, s);
    }

    const result = summaryRows.map((r) => {
      const key = `${r.berry_id}||${r.team_id}||${r.pollination_year}`;
      const s = statusByIds.get(key);
      return {
        berry: r.berry, teamName: r.team_name, pollinationYear: r.pollination_year,
        progenyCount: r.progeny_count,
        berryId: r.berry_id, teamId: r.team_id,
        spCrosses: r.sp_crosses ?? 0,
        pollenDone: s?.Pollen_Done === true ? 1 : 0,
        pollinationDone: s?.Pollination_Done === true ? 1 : 0,
        fruitDone: s?.Fruit_Done === true ? 1 : 0,
        seedDone: s?.Seed_Done === true ? 1 : 0,
        transplantDone: s?.Transplant_Done === true ? 1 : 0,
        screenDone: s?.Screen_Done === true ? 1 : 0,
        shipDone: s?.Ship_Done === true ? 1 : 0,
        modifiedBy: s?.Modified_By ?? null,
        modifiedDateTime: s?.Modified_DateTime ?? null,
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.patch("/lifecycle-status", requireAdmin, async (req, res) => {
  try {
    const { berry, teamName, pollinationYear, step, value, berryId, teamId } = req.body as {
      berry?: string; teamName?: string; pollinationYear?: number;
      step?: string; value?: boolean;
      berryId?: number; teamId?: number;
    };
    if (!step || !STEP_COLUMN_MAP[step]) { res.status(400).json({ message: `Invalid step: ${step}` }); return; }
    if (!pollinationYear) { res.status(400).json({ message: "pollinationYear required" }); return; }
    if (!berryId || !teamId) { res.status(400).json({ message: "berryId and teamId required" }); return; }

    const col = STEP_COLUMN_MAP[step];
    const intValue = value ? 1 : 0;
    const user = (req as AuthenticatedRequest).user?.name ?? "Unknown";

    const existing = await queryOne<{ id: number }>(
      `SELECT TOP 1 LifecycleStatus_ID AS id
         FROM dbo.T_GHLifecycleStatus
        WHERE Berry_ID = @berry AND Team_ID = @team AND Pollination_Year = @py`,
      { berry: String(berryId), team: teamId, py: pollinationYear },
    );
    if (existing) {
      await execute(
        `UPDATE dbo.T_GHLifecycleStatus
            SET ${col} = @val, Modified_By = @user, Modified_DateTime = SYSDATETIME()
          WHERE LifecycleStatus_ID = @id`,
        { id: existing.id, val: intValue, user },
      );
    } else {
      await execute(
        `INSERT INTO dbo.T_GHLifecycleStatus (Berry_ID, Team_ID, Pollination_Year, ${col}, Modified_By, Modified_DateTime)
         VALUES (@berry, @team, @py, @val, @user, SYSDATETIME())`,
        { berry: String(berryId), team: teamId, py: pollinationYear, val: intValue, user },
      );
    }

    // Accept legacy params (berry/teamName) silently for compatibility.
    void berry; void teamName;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/lifecycle-status/completion", async (req, res) => {
  try {
    const where: string[] = ["v.Active = 1"];
    const params: Record<string, unknown> = {};
    if (req.query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
    if (req.query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(req.query.teamId)); }
    if (req.query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(req.query.pollinationYear)); }
    if (req.query.spCrosses === "true") where.push("v.SP_Crosses = 1");

    const combos = await queryMany<{ berry_id: number | null; team_id: number | null; pollination_year: number | null }>(
      `SELECT DISTINCT m.Berry_ID AS berry_id, m.Team_ID AS team_id, v.Pollination_Year AS pollination_year
         FROM dbo.vw_GH_CrossesDesk v
         INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
        WHERE ${where.join(" AND ")}`,
      params,
    );
    if (combos.length === 0) {
      res.json({ pollinationDone: false, seedDone: false, transplantDone: false, shipDone: false });
      return;
    }
    const statusRows = await queryMany<{
      Berry_ID: string; Team_ID: number; Pollination_Year: number | null;
      Pollination_Done: boolean | null; Seed_Done: boolean | null;
      Transplant_Done: boolean | null; Ship_Done: boolean | null;
    }>(
      `SELECT Berry_ID, Team_ID, Pollination_Year, Pollination_Done, Seed_Done, Transplant_Done, Ship_Done
         FROM dbo.T_GHLifecycleStatus`,
    );
    const statusMap = new Map<string, (typeof statusRows)[number]>();
    for (const s of statusRows) statusMap.set(`${s.Berry_ID}||${s.Team_ID}||${s.Pollination_Year}`, s);

    let pollinationDone = true, seedDone = true, transplantDone = true, shipDone = true;
    for (const c of combos) {
      const s = statusMap.get(`${c.berry_id}||${c.team_id}||${c.pollination_year}`);
      if (!s || s.Pollination_Done !== true) pollinationDone = false;
      if (!s || s.Seed_Done !== true) seedDone = false;
      if (!s || s.Transplant_Done !== true) transplantDone = false;
      if (!s || s.Ship_Done !== true) shipDone = false;
    }
    res.json({ pollinationDone, seedDone, transplantDone, shipDone });
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;
