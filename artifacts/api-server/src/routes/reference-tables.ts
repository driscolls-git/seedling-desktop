import { Router, type IRouter, type Request } from "express";
import { queryMany, queryOne, execute, withTransaction } from "@workspace/db";
import {
  CreateTeamBody, UpdateTeamBody,
  CreateProgramBody, UpdateProgramBody,
  CreateLocationBody, UpdateLocationBody,
  CreateRatioBody, UpdateRatioBody,
  CreateTrayBody, UpdateTrayBody,
  CreateLabBody, UpdateLabBody,
  CreateTransplantInstructionBody, UpdateTransplantInstructionBody,
  CreateEmployeeBody, UpdateEmployeeBody,
  CreateMarkerBody, UpdateMarkerBody,
  CreateDeadlineBody, UpdateDeadlineBody,
  CreateMarkerBudgetBody, UpdateMarkerBudgetBody,
  CreateLabPriceBody, UpdateLabPriceBody,
} from "@workspace/api-zod";
import { requireAdmin, requireBreeder, requireMarkerEditor, type AuthenticatedRequest } from "../middleware/auth";
import { recalcSeedlingMaster } from "../services/recalc";

const router: IRouter = Router();

function userName(req: Request): string {
  return (req as AuthenticatedRequest).user?.name ?? "system";
}

function toBit(v: unknown, defaultTrue = true): 0 | 1 {
  if (v === false) return 0;
  if (v === true) return 1;
  if (v === 0 || v === "0" || v === "false") return 0;
  if (v === 1 || v === "1" || v === "true") return 1;
  return defaultTrue ? 1 : 0;
}

// ── Berries (TPN.dbo.M_BerryID) ─────────────────────────────────────────

router.get("/berries", async (_req, res) => {
  const rows = await queryMany<{ id: number; berryType: string; berryCode: string }>(
    `SELECT PK_BerryID AS id, BerryType AS berryType, BerryCode AS berryCode
       FROM TPN.dbo.M_BerryID
      ORDER BY BerryType`,
  );
  res.json(rows);
});

// ── Teams (GHSeed.dbo.M_GHTeams) ────────────────────────────────────────

interface TeamApiRow {
  id: number;
  teamName: string | null;
  active: boolean;
  modifiedDate: string | null;
  modifiedBy: string | null;
}

function fmtTeam(r: { Team_ID: number; Team_Name: string | null; Active: boolean | null; Modified_Date: Date | null; Modified_By: string | null }): TeamApiRow {
  return {
    id: r.Team_ID,
    teamName: r.Team_Name,
    active: r.Active === true,
    modifiedDate: r.Modified_Date ? new Date(r.Modified_Date).toLocaleDateString() : null,
    modifiedBy: r.Modified_By ?? null,
  };
}

router.get("/teams", async (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (req.query.active !== undefined) {
    where.push("Active = @active");
    params.active = toBit(req.query.active);
  }
  const rows = await queryMany<{
    Team_ID: number; Team_Name: string | null; Active: boolean | null;
    Modified_Date: Date | null; Modified_By: string | null;
  }>(
    `SELECT Team_ID, Team_Name, Active, Modified_Date, Modified_By
       FROM dbo.M_GHTeams
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY Team_Name`,
    params,
  );
  res.json(rows.map(fmtTeam));
});

router.post("/teams", requireAdmin, async (req, res) => {
  const body = CreateTeamBody.parse(req.body);
  const row = await queryOne<{ Team_ID: number; Team_Name: string | null; Active: boolean | null; Modified_Date: Date | null; Modified_By: string | null }>(
    `INSERT INTO dbo.M_GHTeams (Team_Name, Active, Created_By, Created_Date)
     OUTPUT INSERTED.Team_ID, INSERTED.Team_Name, INSERTED.Active, INSERTED.Modified_Date, INSERTED.Modified_By
     VALUES (@teamName, @active, @user, GETDATE())`,
    { teamName: body.teamName, active: toBit(body.active), user: userName(req) },
  );
  res.status(201).json(fmtTeam(row!));
});

router.put("/teams/:id", requireAdmin, async (req, res) => {
  const body = UpdateTeamBody.parse(req.body);
  const row = await queryOne<{ Team_ID: number; Team_Name: string | null; Active: boolean | null; Modified_Date: Date | null; Modified_By: string | null }>(
    `UPDATE dbo.M_GHTeams
        SET Team_Name = @teamName, Active = @active,
            Modified_Date = GETDATE(), Modified_By = @user
      OUTPUT INSERTED.Team_ID, INSERTED.Team_Name, INSERTED.Active, INSERTED.Modified_Date, INSERTED.Modified_By
      WHERE Team_ID = @id`,
    { id: parseInt(String(req.params.id)), teamName: body.teamName, active: toBit(body.active), user: userName(req) },
  );
  res.json(fmtTeam(row!));
});

router.delete("/teams/:id", requireAdmin, async (req, res) => {
  const row = await queryOne<{ Team_ID: number; Team_Name: string | null; Active: boolean | null; Modified_Date: Date | null; Modified_By: string | null }>(
    `UPDATE dbo.M_GHTeams
        SET Active = 0, Modified_Date = GETDATE(), Modified_By = @user
      OUTPUT INSERTED.Team_ID, INSERTED.Team_Name, INSERTED.Active, INSERTED.Modified_Date, INSERTED.Modified_By
      WHERE Team_ID = @id`,
    { id: parseInt(String(req.params.id)), user: userName(req) },
  );
  res.json(fmtTeam(row!));
});

// ── Programs (TPN.dbo.M_SrcBreedingProgram) ────────────────────────────

router.get("/programs", async (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (req.query.berryId) { where.push("BerryType = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
  if (req.query.active === "true") { where.push("Active = 1"); }

  const rows = await queryMany<{ id: number; berryType: number | null; srcBreedingProgram: string; active: number }>(
    `SELECT SrcBreedingProgramId AS id, BerryType AS berryType,
            SrcBreedingProgram AS srcBreedingProgram, Active AS active
       FROM TPN.dbo.M_SrcBreedingProgram
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY SrcBreedingProgram`,
    params,
  );
  res.json(rows.map((r) => ({ ...r, active: r.active === 1 })));
});

router.post("/programs", requireAdmin, async (req, res) => {
  const body = CreateProgramBody.parse(req.body);
  const row = await queryOne<{ id: number; berryType: number | null; srcBreedingProgram: string; active: number }>(
    `INSERT INTO TPN.dbo.M_SrcBreedingProgram (BerryType, SrcBreedingProgram, Active, CreatedBy, CreatedDateTime, ModifiedBy, ModifiedDateTime)
     OUTPUT INSERTED.SrcBreedingProgramId AS id, INSERTED.BerryType AS berryType,
            INSERTED.SrcBreedingProgram AS srcBreedingProgram, INSERTED.Active AS active
     VALUES (@berryType, @name, @active, @user, GETDATE(), @user, GETDATE())`,
    { berryType: body.berryType, name: body.srcBreedingProgram, active: toBit(body.active), user: userName(req) },
  );
  res.status(201).json({ ...row!, active: row!.active === 1 });
});

router.put("/programs/:id", requireAdmin, async (req, res) => {
  const body = UpdateProgramBody.parse(req.body);
  const row = await queryOne<{ id: number; berryType: number | null; srcBreedingProgram: string; active: number }>(
    `UPDATE TPN.dbo.M_SrcBreedingProgram
        SET BerryType = @berryType, SrcBreedingProgram = @name, Active = @active,
            ModifiedBy = @user, ModifiedDateTime = GETDATE()
      OUTPUT INSERTED.SrcBreedingProgramId AS id, INSERTED.BerryType AS berryType,
             INSERTED.SrcBreedingProgram AS srcBreedingProgram, INSERTED.Active AS active
      WHERE SrcBreedingProgramId = @id`,
    { id: parseInt(String(req.params.id)), berryType: body.berryType, name: body.srcBreedingProgram, active: toBit(body.active), user: userName(req) },
  );
  res.json({ ...row!, active: row!.active === 1 });
});

router.delete("/programs/:id", requireAdmin, async (req, res) => {
  await execute(`DELETE FROM TPN.dbo.M_SrcBreedingProgram WHERE SrcBreedingProgramId = @id`, { id: parseInt(String(req.params.id)) });
  res.status(204).send();
});

// ── Locations (TPN.dbo.M_Locations) ────────────────────────────────────

router.get("/locations", async (req, res) => {
  const where: string[] = [];
  if (req.query.active === "true") where.push("Active = 1");
  const rows = await queryMany<{ id: number; locationName: string; locationCode: string; active: boolean }>(
    `SELECT Location_ID AS id, LocationName AS locationName, LocationCode AS locationCode, Active AS active
       FROM TPN.dbo.M_Locations
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY LocationName`,
  );
  res.json(rows.map((r) => ({ ...r, active: r.active === true })));
});

router.post("/locations", requireAdmin, async (req, res) => {
  const body = CreateLocationBody.parse(req.body);
  const row = await queryOne<{ id: number; locationName: string; locationCode: string; active: boolean }>(
    `INSERT INTO TPN.dbo.M_Locations (LocationName, LocationCode, Active, Created_By, Created_Datetime)
     OUTPUT INSERTED.Location_ID AS id, INSERTED.LocationName AS locationName,
            INSERTED.LocationCode AS locationCode, INSERTED.Active AS active
     VALUES (@name, @code, @active, @user, GETDATE())`,
    { name: body.locationName, code: body.locationCode, active: toBit(body.active), user: userName(req) },
  );
  res.status(201).json({ ...row!, active: row!.active === true });
});

router.put("/locations/:id", requireAdmin, async (req, res) => {
  const body = UpdateLocationBody.parse(req.body);
  const row = await queryOne<{ id: number; locationName: string; locationCode: string; active: boolean }>(
    `UPDATE TPN.dbo.M_Locations
        SET LocationName = @name, LocationCode = @code, Active = @active,
            Modified_Datetime = GETDATE(), Modified_By = @user
      OUTPUT INSERTED.Location_ID AS id, INSERTED.LocationName AS locationName,
             INSERTED.LocationCode AS locationCode, INSERTED.Active AS active
      WHERE Location_ID = @id`,
    { id: parseInt(String(req.params.id)), name: body.locationName, code: body.locationCode, active: toBit(body.active), user: userName(req) },
  );
  res.json({ ...row!, active: row!.active === true });
});

router.delete("/locations/:id", requireAdmin, async (req, res) => {
  await execute(`DELETE FROM TPN.dbo.M_Locations WHERE Location_ID = @id`, { id: parseInt(String(req.params.id)) });
  res.status(204).send();
});

// ── Ratios (GHSeed.dbo.M_GHRatios) ─────────────────────────────────────

// Writable input columns (user-editable on the form).  These are safe to
// include in INSERT/UPDATE column lists.
const RATIO_INPUT_FIELDS = [
  ["femaleFlowersPerMaleFlower", "Female_Flowers_Per_Male_Flower"],
  ["pollinationSuccessPercentage", "Pollination_Success_Percentage"],
  ["pollinationStdDev", "Pollination_Std_Dev"],
  ["gramsSeedPerFruit", "Grams_Seed_Per_Fruit"],
  ["gramsSeedPerFruitStdDev", "Grams_Seed_Per_Fruit_Std_Dev"],
  ["seedsPerGramOfSeed", "Seeds_Per_Gram_Of_Seed"],
  ["seedNumPerGramStdDev", "Seed_Num_Per_Gram_Std_Dev"],
  ["avgSeedGerminationPercentage", "Avg_Seed_Germination_Percentage"],
  ["seedGerminationStdDev", "Seed_Germination_Std_Dev"],
  ["seedlingTransplantSuccessPercentage", "Seedling_Transplant_Success_Percentage"],
  ["bufferPercentOfStdDev", "Buffer_Percent_Of_Std_Dev"],
  ["avgFlowersPerParent", "Avg_Flowers_Per_Parent"],
  ["flowersPerParentStdDev", "Flowers_Per_Parent_Std_Dev"],
  ["seedSowBufferGrams", "Seed_Sow_Buffer_Grams"],
] as const;

// SQL Server *computed* columns — read-only from our perspective.  Including
// them in INSERT/UPDATE statements raises Msg 271 ("The column ... cannot be
// modified because it is either a computed column ...").  We still SELECT
// these so the GET response keeps the convenience values (Germ_calc etc.
// drive client-side previews).
const RATIO_COMPUTED_FIELDS = [
  ["germCalc", "Germ_calc"],
  ["seedGramCalc", "Seed_Gram_calc"],
  ["gramsSeedPerFruitCalc", "Grams_Seed_Per_Fruit_calc"],
  ["flowersPerParentCalc", "Flowers_per_Parent_Calc"],
  ["pollinationSuccessCalc", "Pollination_Success_Calc"],
  ["seedWeightShippingCalc", "Seed_Weight_Shipping_Calc"],
] as const;

const RATIO_FIELDS = [...RATIO_INPUT_FIELDS, ...RATIO_COMPUTED_FIELDS] as const;

router.get("/ratios", async (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (req.query.berryId) { where.push("r.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
  if (req.query.programId) {
    const pids = String(req.query.programId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (pids.length > 0) {
      const placeholders = pids.map((pid, i) => { params[`prog${i}`] = pid; return `@prog${i}`; });
      where.push(`r.Program_ID IN (${placeholders.join(",")})`);
    }
  }
  if (req.query.teamId) { where.push("r.Team_ID = @teamId"); params.teamId = parseInt(String(req.query.teamId)); }
  if (req.query.active === "true") where.push("r.Active = 1");

  const rows = await queryMany<Record<string, unknown>>(
    `SELECT r.GHRatios_ID AS id,
            r.Berry_ID AS berryId, b.BerryType AS berryType,
            r.Program_ID AS programId, p.SrcBreedingProgram AS srcBreedingProgram,
            r.Team_ID AS teamId, t.Team_Name AS teamName,
            ${RATIO_FIELDS.map(([cc, sc]) => `r.${sc} AS ${cc}`).join(",\n            ")},
            r.Active AS active, r.Comments AS comments,
            r.Modified_Date AS modifiedDate, r.Modified_By AS modifiedBy
       FROM dbo.M_GHRatios r
       LEFT JOIN dbo.M_GHTeams t ON r.Team_ID = t.Team_ID
       LEFT JOIN TPN.dbo.M_BerryID b ON r.Berry_ID = b.PK_BerryID
       LEFT JOIN TPN.dbo.M_SrcBreedingProgram p ON r.Program_ID = p.SrcBreedingProgramId
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY r.GHRatios_ID`,
    params,
  );
  res.json(rows.map((r) => ({
    ...r,
    active: r.active === true,
    modifiedDate: r.modifiedDate instanceof Date ? r.modifiedDate.toISOString() : null,
  })));
});

router.post("/ratios", requireAdmin, async (req, res) => {
  const body = CreateRatioBody.parse(req.body);

  // Enforce uniqueness on (Berry_ID, Team_ID, Program_ID) for active ratios.
  // Client-side check exists but server-side guard prevents stale-data races.
  const dup = await queryOne<{ id: number }>(
    `SELECT TOP 1 GHRatios_ID AS id
       FROM dbo.M_GHRatios
      WHERE Berry_ID = @berryId AND Team_ID = @teamId AND Program_ID = @programId
        AND Active = 1`,
    { berryId: body.berryId, teamId: body.teamId, programId: body.programId },
  );
  if (dup) {
    res.status(409).json({
      message: "An active ratio with this Berry, Team, and Program combination already exists.",
    });
    return;
  }

  const cols = ["Berry_ID", "Program_ID", "Team_ID", ...RATIO_INPUT_FIELDS.map(([, sc]) => sc), "Comments", "Active", "Created_By", "Created_Date"];
  const values = ["@berryId", "@programId", "@teamId", ...RATIO_INPUT_FIELDS.map(([cc]) => `@${cc}`), "@comments", "@active", "@user", "GETDATE()"];
  const params: Record<string, unknown> = {
    berryId: body.berryId, programId: body.programId, teamId: body.teamId,
    comments: body.comments ?? null, active: toBit(body.active), user: userName(req),
  };
  for (const [cc] of RATIO_INPUT_FIELDS) params[cc] = (body as Record<string, unknown>)[cc] ?? null;

  const row = await queryOne<{ id: number; active: boolean }>(
    `INSERT INTO dbo.M_GHRatios (${cols.join(", ")})
     OUTPUT INSERTED.GHRatios_ID AS id, INSERTED.Active AS active
     VALUES (${values.join(", ")})`,
    params,
  );
  // M_GHRatios is joined by usp_Update_GHSeedlingMaster_Calculations on
  // GHRatios_FK; a new/changed/deleted ratio can shift TRANSPLANTS_REQUIRED,
  // SEED_WEIGHT_REQUIRED, etc. on every cross that uses it.  Re-fire the proc.
  await recalcSeedlingMaster();
  res.status(201).json({ id: row!.id, active: row!.active === true });
});

router.put("/ratios/:id", requireAdmin, async (req, res) => {
  const body = UpdateRatioBody.parse(req.body);
  const sets = [
    "Berry_ID = @berryId", "Program_ID = @programId", "Team_ID = @teamId",
    ...RATIO_INPUT_FIELDS.map(([cc, sc]) => `${sc} = @${cc}`),
    "Comments = @comments", "Active = @active", "Modified_Date = GETDATE()", "Modified_By = @user",
  ];
  const params: Record<string, unknown> = {
    id: parseInt(String(req.params.id)),
    berryId: body.berryId, programId: body.programId, teamId: body.teamId,
    comments: body.comments ?? null, active: toBit(body.active), user: userName(req),
  };
  for (const [cc] of RATIO_INPUT_FIELDS) params[cc] = (body as Record<string, unknown>)[cc] ?? null;

  const row = await queryOne<{ id: number; active: boolean }>(
    `UPDATE dbo.M_GHRatios
        SET ${sets.join(", ")}
      OUTPUT INSERTED.GHRatios_ID AS id, INSERTED.Active AS active
      WHERE GHRatios_ID = @id`,
    params,
  );
  await recalcSeedlingMaster();
  res.json({ id: row!.id, active: row!.active === true });
});

router.delete("/ratios/:id", requireAdmin, async (req, res) => {
  await execute(`DELETE FROM dbo.M_GHRatios WHERE GHRatios_ID = @id`, { id: parseInt(String(req.params.id)) });
  await recalcSeedlingMaster();
  res.status(204).send();
});

// ── Trays (GHSeed.dbo.M_GHTraySize) ────────────────────────────────────

function fmtTray(r: { Tray_Size_ID: number; Tray_Size: number | null; M2_Per_Tray: number | null; Active: boolean | null; Modified_DateTime: Date | null; Modified_By: string | null }) {
  return {
    id: r.Tray_Size_ID,
    traySize: r.Tray_Size,
    m2PerTray: r.M2_Per_Tray,
    active: r.Active === true,
    modifiedDate: r.Modified_DateTime ? new Date(r.Modified_DateTime).toLocaleDateString() : null,
    modifiedBy: r.Modified_By ?? null,
  };
}

router.get("/trays", async (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (req.query.active !== undefined) {
    where.push("Active = @active");
    params.active = toBit(req.query.active);
  }
  const rows = await queryMany<Parameters<typeof fmtTray>[0]>(
    `SELECT Tray_Size_ID, Tray_Size, M2_Per_Tray, Active, Modified_DateTime, Modified_By
       FROM dbo.M_GHTraySize
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY Tray_Size`,
    params,
  );
  res.json(rows.map(fmtTray));
});

router.post("/trays", requireAdmin, async (req, res) => {
  const body = CreateTrayBody.parse(req.body);
  const row = await queryOne<Parameters<typeof fmtTray>[0]>(
    `INSERT INTO dbo.M_GHTraySize (Tray_Size, M2_Per_Tray, Active, Created_By, Created_DateTime)
     OUTPUT INSERTED.Tray_Size_ID, INSERTED.Tray_Size, INSERTED.M2_Per_Tray, INSERTED.Active, INSERTED.Modified_DateTime, INSERTED.Modified_By
     VALUES (@traySize, @m2, @active, @user, GETDATE())`,
    { traySize: body.traySize, m2: body.m2PerTray ?? null, active: toBit(body.active), user: userName(req) },
  );
  res.status(201).json(fmtTray(row!));
});

router.put("/trays/:id", requireAdmin, async (req, res) => {
  const body = UpdateTrayBody.parse(req.body);
  const row = await queryOne<Parameters<typeof fmtTray>[0]>(
    `UPDATE dbo.M_GHTraySize
        SET Tray_Size = @traySize, M2_Per_Tray = @m2, Active = @active,
            Modified_DateTime = GETDATE(), Modified_By = @user
      OUTPUT INSERTED.Tray_Size_ID, INSERTED.Tray_Size, INSERTED.M2_Per_Tray, INSERTED.Active, INSERTED.Modified_DateTime, INSERTED.Modified_By
      WHERE Tray_Size_ID = @id`,
    { id: parseInt(String(req.params.id)), traySize: body.traySize, m2: body.m2PerTray ?? null, active: toBit(body.active), user: userName(req) },
  );
  res.json(fmtTray(row!));
});

router.delete("/trays/:id", requireAdmin, async (req, res) => {
  const row = await queryOne<Parameters<typeof fmtTray>[0]>(
    `UPDATE dbo.M_GHTraySize
        SET Active = 0, Modified_DateTime = GETDATE(), Modified_By = @user
      OUTPUT INSERTED.Tray_Size_ID, INSERTED.Tray_Size, INSERTED.M2_Per_Tray, INSERTED.Active, INSERTED.Modified_DateTime, INSERTED.Modified_By
      WHERE Tray_Size_ID = @id`,
    { id: parseInt(String(req.params.id)), user: userName(req) },
  );
  res.json(fmtTray(row!));
});

// ── Labs (GHSeed.dbo.M_GHLabs) ─────────────────────────────────────────

function fmtLab(r: { GHLab_ID: number; Lab_Name: string | null; Plate_Sample_Num: number | null; Active: boolean | null; ModifiedDateTime: Date | null; ModifiedBy: string | null }) {
  return {
    id: r.GHLab_ID,
    labName: r.Lab_Name,
    plateSampleNum: r.Plate_Sample_Num,
    active: r.Active === true,
    modifiedDate: r.ModifiedDateTime ? new Date(r.ModifiedDateTime).toLocaleDateString() : null,
    modifiedBy: r.ModifiedBy ?? null,
  };
}

router.get("/labs", async (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (req.query.active !== undefined) { where.push("Active = @active"); params.active = toBit(req.query.active); }
  const rows = await queryMany<Parameters<typeof fmtLab>[0]>(
    `SELECT GHLab_ID, Lab_Name, Plate_Sample_Num, Active, ModifiedDateTime, ModifiedBy
       FROM dbo.M_GHLabs
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY Lab_Name`,
    params,
  );
  res.json(rows.map(fmtLab));
});

router.post("/labs", requireAdmin, async (req, res) => {
  const body = CreateLabBody.parse(req.body);
  const row = await queryOne<Parameters<typeof fmtLab>[0]>(
    `INSERT INTO dbo.M_GHLabs (Lab_Name, Plate_Sample_Num, Active, CreatedBy, CreatedDateTime)
     OUTPUT INSERTED.GHLab_ID, INSERTED.Lab_Name, INSERTED.Plate_Sample_Num, INSERTED.Active, INSERTED.ModifiedDateTime, INSERTED.ModifiedBy
     VALUES (@name, @plate, @active, @user, GETDATE())`,
    { name: body.labName, plate: body.plateSampleNum ?? null, active: toBit(body.active), user: userName(req) },
  );
  // M_GHLabs.Plate_Sample_Num is used in proc step 1 (TRANSPLANTS_REQUIRED).
  await recalcSeedlingMaster();
  res.status(201).json(fmtLab(row!));
});

router.put("/labs/:id", requireAdmin, async (req, res) => {
  const body = UpdateLabBody.parse(req.body);
  const row = await queryOne<Parameters<typeof fmtLab>[0]>(
    `UPDATE dbo.M_GHLabs
        SET Lab_Name = @name, Plate_Sample_Num = @plate, Active = @active,
            ModifiedDateTime = GETDATE(), ModifiedBy = @user
      OUTPUT INSERTED.GHLab_ID, INSERTED.Lab_Name, INSERTED.Plate_Sample_Num, INSERTED.Active, INSERTED.ModifiedDateTime, INSERTED.ModifiedBy
      WHERE GHLab_ID = @id`,
    { id: parseInt(String(req.params.id)), name: body.labName, plate: body.plateSampleNum ?? null, active: toBit(body.active), user: userName(req) },
  );
  await recalcSeedlingMaster();
  res.json(fmtLab(row!));
});

router.delete("/labs/:id", requireAdmin, async (req, res) => {
  const row = await queryOne<Parameters<typeof fmtLab>[0]>(
    `UPDATE dbo.M_GHLabs
        SET Active = 0, ModifiedDateTime = GETDATE(), ModifiedBy = @user
      OUTPUT INSERTED.GHLab_ID, INSERTED.Lab_Name, INSERTED.Plate_Sample_Num, INSERTED.Active, INSERTED.ModifiedDateTime, INSERTED.ModifiedBy
      WHERE GHLab_ID = @id`,
    { id: parseInt(String(req.params.id)), user: userName(req) },
  );
  await recalcSeedlingMaster();
  res.json(fmtLab(row!));
});

// ── Transplant Instructions (GHSeed.dbo.M_GHTransplant_Instructions) ──

router.get("/transplant-instructions", async (_req, res) => {
  const rows = await queryMany<{ id: number; transplantInstruct: string }>(
    `SELECT TransplantInstructionID AS id, Instructions AS transplantInstruct
       FROM dbo.M_GHTransplant_Instructions
      WHERE Active = 1
      ORDER BY Instructions`,
  );
  res.json(rows);
});

router.post("/transplant-instructions", requireAdmin, async (req, res) => {
  const body = CreateTransplantInstructionBody.parse(req.body);
  const row = await queryOne<{ id: number; transplantInstruct: string }>(
    `INSERT INTO dbo.M_GHTransplant_Instructions (Instructions, CreatedBy, CreatedDateTime, Active)
     OUTPUT INSERTED.TransplantInstructionID AS id, INSERTED.Instructions AS transplantInstruct
     VALUES (@txt, @user, GETDATE(), 1)`,
    { txt: body.transplantInstruct, user: userName(req) },
  );
  res.status(201).json(row!);
});

router.put("/transplant-instructions/:id", requireAdmin, async (req, res) => {
  const body = UpdateTransplantInstructionBody.parse(req.body);
  const row = await queryOne<{ id: number; transplantInstruct: string }>(
    `UPDATE dbo.M_GHTransplant_Instructions
        SET Instructions = @txt, ModifiedBy = @user, ModifiedDateTime = GETDATE()
      OUTPUT INSERTED.TransplantInstructionID AS id, INSERTED.Instructions AS transplantInstruct
      WHERE TransplantInstructionID = @id`,
    { id: parseInt(String(req.params.id)), txt: body.transplantInstruct, user: userName(req) },
  );
  res.json(row!);
});

router.delete("/transplant-instructions/:id", requireAdmin, async (req, res) => {
  await execute(
    `UPDATE dbo.M_GHTransplant_Instructions SET Active = 0, ModifiedBy = @user, ModifiedDateTime = GETDATE() WHERE TransplantInstructionID = @id`,
    { id: parseInt(String(req.params.id)), user: userName(req) },
  );
  res.status(204).send();
});

// ── Employees (CRUD — list/get is in auth.ts) ─────────────────────────

async function loadTeamName(teamId: number | null | undefined): Promise<string | null> {
  if (!teamId) return null;
  const row = await queryOne<{ Team_Name: string | null }>(
    `SELECT Team_Name FROM dbo.M_GHTeams WHERE Team_ID = @id`,
    { id: teamId },
  );
  return row?.Team_Name ?? null;
}

function fmtEmployee(
  r: {
    GHEmployee_ID: number; GH_Employee: string | null; Employee_Num: number | null;
    Team_ID: number | null; Active: boolean | null; UserLevel_FK: number | null; Email: string | null;
    Modified_DateTime: Date | null; Modified_By: string | null;
  },
  teamName: string | null,
) {
  return {
    id: r.GHEmployee_ID,
    ghEmployee: r.GH_Employee,
    employeeNum: r.Employee_Num,
    teamId: r.Team_ID,
    teamName,
    active: r.Active === true,
    userLevelFk: r.UserLevel_FK,
    email: r.Email,
    modifiedDate: r.Modified_DateTime ? new Date(r.Modified_DateTime).toLocaleDateString() : null,
    modifiedBy: r.Modified_By ?? null,
  };
}

router.post("/employees", requireAdmin, async (req, res) => {
  const body = CreateEmployeeBody.parse(req.body);
  const row = await queryOne<Parameters<typeof fmtEmployee>[0]>(
    `INSERT INTO dbo.T_GHEmployees
       (GH_Employee, Employee_Num, Team_ID, Active, UserLevel_FK, Email, Created_By, Created_DateTime)
     OUTPUT INSERTED.GHEmployee_ID, INSERTED.GH_Employee, INSERTED.Employee_Num, INSERTED.Team_ID,
            INSERTED.Active, INSERTED.UserLevel_FK, INSERTED.Email, INSERTED.Modified_DateTime, INSERTED.Modified_By
     VALUES (@name, @num, @team, @active, @level, @email, @user, GETDATE())`,
    {
      name: body.ghEmployee, num: body.employeeNum, team: body.teamId ?? null,
      active: toBit(body.active), level: body.userLevelFk ?? 1, email: body.email ?? null,
      user: userName(req),
    },
  );
  res.status(201).json(fmtEmployee(row!, await loadTeamName(row!.Team_ID)));
});

router.put("/employees/:id", requireAdmin, async (req, res) => {
  const body = UpdateEmployeeBody.parse(req.body);
  const row = await queryOne<Parameters<typeof fmtEmployee>[0]>(
    `UPDATE dbo.T_GHEmployees
        SET GH_Employee = @name, Employee_Num = @num, Team_ID = @team, Active = @active,
            UserLevel_FK = @level, Email = @email,
            Modified_DateTime = GETDATE(), Modified_By = @user
      OUTPUT INSERTED.GHEmployee_ID, INSERTED.GH_Employee, INSERTED.Employee_Num, INSERTED.Team_ID,
             INSERTED.Active, INSERTED.UserLevel_FK, INSERTED.Email, INSERTED.Modified_DateTime, INSERTED.Modified_By
      WHERE GHEmployee_ID = @id`,
    {
      id: parseInt(String(req.params.id)),
      name: body.ghEmployee, num: body.employeeNum, team: body.teamId ?? null,
      active: toBit(body.active), level: body.userLevelFk ?? null, email: body.email ?? null,
      user: userName(req),
    },
  );
  res.json(fmtEmployee(row!, await loadTeamName(row!.Team_ID)));
});

router.delete("/employees/:id", requireAdmin, async (req, res) => {
  const row = await queryOne<Parameters<typeof fmtEmployee>[0]>(
    `UPDATE dbo.T_GHEmployees
        SET Active = 0, Modified_DateTime = GETDATE(), Modified_By = @user
      OUTPUT INSERTED.GHEmployee_ID, INSERTED.GH_Employee, INSERTED.Employee_Num, INSERTED.Team_ID,
             INSERTED.Active, INSERTED.UserLevel_FK, INSERTED.Email, INSERTED.Modified_DateTime, INSERTED.Modified_By
      WHERE GHEmployee_ID = @id`,
    { id: parseInt(String(req.params.id)), user: userName(req) },
  );
  res.json(fmtEmployee(row!, await loadTeamName(row!.Team_ID)));
});

// ── Selections (distinct from T_GHParentInventory2, joined with berry) ─
//
// GHSeed has no `Selections` catalog table.  We approximate the Cross Form's
// selection dropdown by surfacing distinct `Selection` values from
// T_GHParentInventory2, joined to berry name.

router.get("/selections", async (req, res) => {
  const where: string[] = ["pi.Active = 1"];
  const params: Record<string, unknown> = {};
  if (req.query.berry) { where.push("b.BerryType = @berry"); params.berry = String(req.query.berry); }
  // berryId / pollinationYear / teamId are used by the Cross Form to restrict
  // the parent dropdown to selections that actually exist in this
  // (berry, year, team) combo of parent inventory.
  if (req.query.berryId) { where.push("pi.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
  if (req.query.pollinationYear) { where.push("pi.Pollination_Year = @py"); params.py = parseInt(String(req.query.pollinationYear)); }
  if (req.query.teamId) { where.push("pi.Team_ID = @teamId"); params.teamId = parseInt(String(req.query.teamId)); }
  if (req.query.search) {
    where.push("pi.Selection LIKE @search");
    params.search = `%${String(req.query.search)}%`;
  }
  const rows = await queryMany<{
    id: number; selection: string; berry: string | null; active: boolean;
  }>(
    `SELECT MIN(pi.GHParentInventory_ID) AS id, pi.Selection AS selection,
            b.BerryType AS berry, CAST(1 AS BIT) AS active
       FROM dbo.T_GHParentInventory2 pi
       LEFT JOIN TPN.dbo.M_BerryID b ON pi.Berry_ID = b.PK_BerryID
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY pi.Selection, b.BerryType
      ORDER BY pi.Selection`,
    params,
  );
  res.json(rows.map((r) => ({
    id: r.id,
    selection: r.selection,
    varietyName: null,
    berry: r.berry,
    sourceBreedingProgram: null,
    floweringType: null,
    active: r.active === true,
  })));
});

// ── Markers (GHSeed.dbo.M_GHMarkerLabs) ───────────────────────────────

router.get("/markers", async (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (req.query.active !== undefined) { where.push("m.Active = @active"); params.active = toBit(req.query.active); }
  if (req.query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }

  const rows = await queryMany<{
    id: number; berryId: number | null; berryType: string | null;
    preferredLabId: number | null; preferredLabName: string | null;
    traitMarker: string | null; markerAliasDriscolls: string | null;
    markerAliasCorteva: string | null; cortevaLabStatus: string | null;
    lgcLabStatus: string | null; active: boolean;
  }>(
    `SELECT m.GHMarkerLabs_ID AS id, m.Berry_ID AS berryId, b.BerryType AS berryType,
            m.Preferred_Lab_ID AS preferredLabId, l.Lab_Name AS preferredLabName,
            m.Trait_Marker AS traitMarker, m.Marker_Alias_Driscolls AS markerAliasDriscolls,
            m.Marker_Alias_Corteva AS markerAliasCorteva, m.Corteva_Lab_Status AS cortevaLabStatus,
            m.LGC_Lab_Status AS lgcLabStatus, m.Active AS active
       FROM dbo.M_GHMarkerLabs m
       LEFT JOIN TPN.dbo.M_BerryID b ON m.Berry_ID = b.PK_BerryID
       LEFT JOIN dbo.M_GHLabs l ON m.Preferred_Lab_ID = l.GHLab_ID
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY m.Trait_Marker`,
    params,
  );
  res.json(rows.map((r) => ({
    ...r,
    berryType: r.berryType ?? "",
    preferredLabName: r.preferredLabName ?? "",
    traitMarker: r.traitMarker ?? "",
    markerAliasDriscolls: r.markerAliasDriscolls ?? "",
    markerAliasCorteva: r.markerAliasCorteva ?? "",
    cortevaLabStatus: r.cortevaLabStatus ?? "",
    lgcLabStatus: r.lgcLabStatus ?? "",
    active: r.active === true,
  })));
});

router.post("/markers", requireBreeder, async (req, res) => {
  const body = CreateMarkerBody.parse(req.body);
  const row = await queryOne<{ id: number; traitMarker: string | null; active: boolean }>(
    `INSERT INTO dbo.M_GHMarkerLabs
       (Berry_ID, Preferred_Lab_ID, Trait_Marker, Marker_Alias_Driscolls, Marker_Alias_Corteva,
        Corteva_Lab_Status, LGC_Lab_Status, Active, Created_By, Created_DateTime)
     OUTPUT INSERTED.GHMarkerLabs_ID AS id, INSERTED.Trait_Marker AS traitMarker, INSERTED.Active AS active
     VALUES (@berry, @lab, @trait, @aliasD, @aliasC, @cStatus, @lStatus, @active, @user, GETDATE())`,
    {
      berry: body.berryId ?? null, lab: body.preferredLabId ?? null,
      trait: body.traitMarker ?? null, aliasD: body.markerAliasDriscolls ?? null,
      aliasC: body.markerAliasCorteva ?? null, cStatus: body.cortevaLabStatus ?? null,
      lStatus: body.lgcLabStatus ?? null, active: toBit(body.active), user: userName(req),
    },
  );
  res.status(201).json({ id: row!.id, traitMarker: row!.traitMarker, active: row!.active === true });
});

router.put("/markers/:id", requireBreeder, async (req, res) => {
  const body = UpdateMarkerBody.parse(req.body);
  const row = await queryOne<{ id: number; traitMarker: string | null; active: boolean }>(
    `UPDATE dbo.M_GHMarkerLabs
        SET Berry_ID = @berry, Preferred_Lab_ID = @lab, Trait_Marker = @trait,
            Marker_Alias_Driscolls = @aliasD, Marker_Alias_Corteva = @aliasC,
            Corteva_Lab_Status = @cStatus, LGC_Lab_Status = @lStatus, Active = @active,
            Modified_By = @user, Modified_DateTime = GETDATE()
      OUTPUT INSERTED.GHMarkerLabs_ID AS id, INSERTED.Trait_Marker AS traitMarker, INSERTED.Active AS active
      WHERE GHMarkerLabs_ID = @id`,
    {
      id: parseInt(String(req.params.id)),
      berry: body.berryId ?? null, lab: body.preferredLabId ?? null,
      trait: body.traitMarker ?? null, aliasD: body.markerAliasDriscolls ?? null,
      aliasC: body.markerAliasCorteva ?? null, cStatus: body.cortevaLabStatus ?? null,
      lStatus: body.lgcLabStatus ?? null, active: toBit(body.active), user: userName(req),
    },
  );
  res.json({ id: row!.id, traitMarker: row!.traitMarker, active: row!.active === true });
});

router.delete("/markers/:id", requireBreeder, async (req, res) => {
  const row = await queryOne<{ id: number; traitMarker: string | null; active: boolean }>(
    `UPDATE dbo.M_GHMarkerLabs
        SET Active = 0, Modified_By = @user, Modified_DateTime = GETDATE()
      OUTPUT INSERTED.GHMarkerLabs_ID AS id, INSERTED.Trait_Marker AS traitMarker, INSERTED.Active AS active
      WHERE GHMarkerLabs_ID = @id`,
    { id: parseInt(String(req.params.id)), user: userName(req) },
  );
  res.json({ id: row!.id, traitMarker: row!.traitMarker, active: row!.active === true });
});

// ── Deadlines (GHSeed.dbo.M_GHDeadlines) ──────────────────────────────

const DEADLINE_FIELDS = [
  ["crossingFileDeadline", "Crossing_File_Deadline"],
  ["pollinationStart", "Pollination_Start"],
  ["pollinationDeadline", "Pollination_Deadline"],
  ["fruitCollectStart", "Fruit_Collect_Start"],
  ["fruitCollectDeadline", "Fruit_Collect_Deadline"],
  ["seedAcidStart", "Seed_Acid_Start"],
  ["seedAcidDeadline", "Seed_Acid_Deadline"],
  ["seedSowStart", "Seed_Sow_Start"],
  ["seedSowDeadline", "Seed_Sow_Deadline"],
  ["transplantStart", "Transplant_Start"],
  ["transplantDeadline", "Transplant_Deadline"],
  ["markerScreenStart", "Marker_Screen_Start"],
  ["markerScreenDeadline", "Marker_Screening_Deadline"],
  ["markerResultsDeadline", "Marker_Results_Deadline"],
] as const;

router.get("/deadlines", async (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (req.query.berryId) { where.push("d.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
  if (req.query.teamId) { where.push("d.Team_ID = @teamId"); params.teamId = parseInt(String(req.query.teamId)); }
  if (req.query.destinationId) {
    const dids = String(req.query.destinationId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (dids.length > 0) {
      const placeholders = dids.map((did, i) => { params[`dest${i}`] = did; return `@dest${i}`; });
      where.push(`d.Destination_ID IN (${placeholders.join(",")})`);
    }
  }
  if (req.query.programId) {
    const pids = String(req.query.programId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (pids.length > 0) {
      const placeholders = pids.map((pid, i) => { params[`prog${i}`] = pid; return `@prog${i}`; });
      where.push(`d.Program_ID IN (${placeholders.join(",")})`);
    }
  }
  if (req.query.active === "true") where.push("d.Active = 1");
  if (req.query.active === "false") where.push("d.Active = 0");

  const rows = await queryMany<Record<string, unknown>>(
    `SELECT d.Deadlines_ID AS id,
            d.Berry_ID AS berryId, b.BerryType AS berryType,
            d.Team_ID AS teamId, t.Team_Name AS teamName,
            d.Destination_ID AS destinationId, l.LocationName AS destination,
            d.Program_ID AS programId, p.SrcBreedingProgram AS srcBreedingProgram,
            ${DEADLINE_FIELDS.map(([cc, sc]) => `d.${sc} AS ${cc}`).join(",\n            ")},
            d.Comments AS comments, d.Active AS active,
            d.Modified_By AS modifiedBy, d.Modified_DateTime AS modifiedDateTime
       FROM dbo.M_GHDeadlines d
       LEFT JOIN TPN.dbo.M_BerryID b ON d.Berry_ID = b.PK_BerryID
       LEFT JOIN dbo.M_GHTeams t ON d.Team_ID = t.Team_ID
       LEFT JOIN TPN.dbo.M_Locations l ON d.Destination_ID = l.Location_ID
       LEFT JOIN TPN.dbo.M_SrcBreedingProgram p ON d.Program_ID = p.SrcBreedingProgramId
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`,
    params,
  );
  res.json(rows.map((r) => ({
    ...r,
    berryType: r.berryType ?? "",
    teamName: r.teamName ?? "",
    destination: r.destination ?? "",
    srcBreedingProgram: r.srcBreedingProgram ?? "",
    modifiedDate: r.modifiedDateTime instanceof Date ? r.modifiedDateTime.toISOString() : null,
    modifiedBy: r.modifiedBy ?? null,
    active: r.active === true,
    modifiedDateTime: undefined,
  })));
});

router.post("/deadlines", requireAdmin, async (req, res) => {
  const body = CreateDeadlineBody.parse(req.body);

  // Enforce uniqueness on (Berry_ID, Team_ID, Destination_ID, Program_ID)
  // for active deadlines.  Mirrors the client-side check; server-side guard
  // catches stale-cache races between two simultaneous creators.
  const dup = await queryOne<{ id: number }>(
    `SELECT TOP 1 Deadlines_ID AS id
       FROM dbo.M_GHDeadlines
      WHERE Berry_ID = @berryId AND Team_ID = @teamId
        AND Destination_ID = @destId AND Program_ID = @progId
        AND Active = 1`,
    {
      berryId: body.berryId ?? null, teamId: body.teamId ?? null,
      destId: body.destinationId ?? null, progId: body.programId ?? null,
    },
  );
  if (dup) {
    res.status(409).json({
      message: "An active deadline with this Berry, Team, Destination, and Program combination already exists.",
    });
    return;
  }

  const cols = ["Berry_ID", "Team_ID", "Destination_ID", "Program_ID",
    ...DEADLINE_FIELDS.map(([, sc]) => sc), "Comments", "Active", "Created_By", "Created_DateTime"];
  const values = ["@berryId", "@teamId", "@destId", "@progId",
    ...DEADLINE_FIELDS.map(([cc]) => `@${cc}`), "@comments", "@active", "@user", "GETDATE()"];
  const params: Record<string, unknown> = {
    berryId: body.berryId ?? null, teamId: body.teamId ?? null,
    destId: body.destinationId ?? null, progId: body.programId ?? null,
    comments: body.comments ?? null, active: toBit(body.active), user: userName(req),
  };
  for (const [cc] of DEADLINE_FIELDS) params[cc] = (body as Record<string, unknown>)[cc] ?? null;

  const row = await queryOne<{ id: number; active: boolean }>(
    `INSERT INTO dbo.M_GHDeadlines (${cols.join(", ")})
     OUTPUT INSERTED.Deadlines_ID AS id, INSERTED.Active AS active
     VALUES (${values.join(", ")})`,
    params,
  );
  // M_GHDeadlines is joined by usp_Update_GHSeedlingMaster_Calculations on
  // Deadlines_FK; the proc gates each step's UPDATE on whether the
  // corresponding deadline has passed, so changes here can flip rows
  // between eligible/skipped.
  await recalcSeedlingMaster();
  res.status(201).json({ id: row!.id, active: row!.active === true });
});

router.put("/deadlines/:id", requireAdmin, async (req, res) => {
  const body = UpdateDeadlineBody.parse(req.body);
  const sets = ["Berry_ID = @berryId", "Team_ID = @teamId", "Destination_ID = @destId", "Program_ID = @progId",
    ...DEADLINE_FIELDS.map(([cc, sc]) => `${sc} = @${cc}`),
    "Comments = @comments", "Active = @active", "Modified_By = @user", "Modified_DateTime = GETDATE()"];
  const params: Record<string, unknown> = {
    id: parseInt(String(req.params.id)),
    berryId: body.berryId ?? null, teamId: body.teamId ?? null,
    destId: body.destinationId ?? null, progId: body.programId ?? null,
    comments: body.comments ?? null, active: toBit(body.active), user: userName(req),
  };
  for (const [cc] of DEADLINE_FIELDS) params[cc] = (body as Record<string, unknown>)[cc] ?? null;

  const row = await queryOne<{ id: number; active: boolean }>(
    `UPDATE dbo.M_GHDeadlines SET ${sets.join(", ")}
      OUTPUT INSERTED.Deadlines_ID AS id, INSERTED.Active AS active
      WHERE Deadlines_ID = @id`,
    params,
  );
  await recalcSeedlingMaster();
  res.json({ id: row!.id, active: row!.active === true });
});

router.delete("/deadlines/:id", requireAdmin, async (req, res) => {
  const row = await queryOne<{ id: number }>(
    `UPDATE dbo.M_GHDeadlines
        SET Active = 0, Modified_By = @user, Modified_DateTime = GETDATE()
      OUTPUT INSERTED.Deadlines_ID AS id
      WHERE Deadlines_ID = @id`,
    { id: parseInt(String(req.params.id)), user: userName(req) },
  );
  await recalcSeedlingMaster();
  res.json({ id: row!.id, active: false });
});

// ── Marker Allocations (GHSeed.dbo.M_GHMarkerAllocation) ──────────────
// NOTE: No Active / audit columns on this table.  Delete = hard delete.

router.get("/marker-budgets", async (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (req.query.berryId) { where.push("a.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
  if (req.query.teamId) { where.push("a.GHTeam_ID = @teamId"); params.teamId = parseInt(String(req.query.teamId)); }
  if (req.query.pollinationYear) { where.push("a.Pollination_Year = @year"); params.year = parseInt(String(req.query.pollinationYear)); }
  if (req.query.programId) { where.push("a.Program_ID = @progId"); params.progId = parseInt(String(req.query.programId)); }
  if (req.query.labId) { where.push("a.GHLab_ID = @labId"); params.labId = parseInt(String(req.query.labId)); }

  const rows = await queryMany<{
    id: number; markerSampleAllocationTotal: number | null; markerCostAllocationTotal: number | null;
    pollinationYear: number | null; berryId: number | null; berryType: string | null;
    programId: number | null; srcBreedingProgram: string | null;
    ghLabId: number | null; ghLabName: string | null;
    ghTeamId: number | null; ghTeamName: string | null;
  }>(
    `SELECT a.M_GHMarkerAllocationID AS id,
            a.Marker_Sample_Allocation_Total AS markerSampleAllocationTotal,
            a.Marker_Cost_Allocation_Total AS markerCostAllocationTotal,
            a.Pollination_Year AS pollinationYear,
            a.Berry_ID AS berryId, b.BerryType AS berryType,
            a.Program_ID AS programId, p.SrcBreedingProgram AS srcBreedingProgram,
            a.GHLab_ID AS ghLabId, l.Lab_Name AS ghLabName,
            a.GHTeam_ID AS ghTeamId, t.Team_Name AS ghTeamName
       FROM dbo.M_GHMarkerAllocation a
       LEFT JOIN TPN.dbo.M_BerryID b ON a.Berry_ID = b.PK_BerryID
       LEFT JOIN TPN.dbo.M_SrcBreedingProgram p ON a.Program_ID = p.SrcBreedingProgramId
       LEFT JOIN dbo.M_GHLabs l ON a.GHLab_ID = l.GHLab_ID
       LEFT JOIN dbo.M_GHTeams t ON a.GHTeam_ID = t.Team_ID
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.M_GHMarkerAllocationID`,
    params,
  );
  res.json(rows.map((r) => ({
    ...r,
    berryType: r.berryType ?? "",
    srcBreedingProgram: r.srcBreedingProgram ?? "",
    ghLabName: r.ghLabName ?? "",
    ghTeamName: r.ghTeamName ?? "",
    active: true,
  })));
});

router.post("/marker-budgets", requireMarkerEditor, async (req, res) => {
  const body = CreateMarkerBudgetBody.parse(req.body);
  // M_GHMarkerAllocationID is NOT an identity column and has no default;
  // we compute the next PK manually under a transaction with TABLOCKX to
  // avoid races on the MAX(...) lookup.
  const id = await withTransaction(async (tx) => {
    const next = await tx.queryOne<{ nextId: number }>(
      `SELECT ISNULL(MAX(M_GHMarkerAllocationID), 0) + 1 AS nextId
         FROM dbo.M_GHMarkerAllocation WITH (TABLOCKX, HOLDLOCK)`,
    );
    const newId = next!.nextId;
    await tx.execute(
      `INSERT INTO dbo.M_GHMarkerAllocation
         (M_GHMarkerAllocationID, Marker_Sample_Allocation_Total, Marker_Cost_Allocation_Total,
          Pollination_Year, Berry_ID, Program_ID, GHLab_ID, GHTeam_ID)
       VALUES (@id, @sample, @cost, @year, @berry, @prog, @lab, @team)`,
      {
        id: newId,
        sample: body.markerSampleAllocationTotal ?? null, cost: body.markerCostAllocationTotal ?? null,
        year: body.pollinationYear ?? null, berry: body.berryId ?? null,
        prog: body.programId ?? null, lab: body.ghLabId ?? null, team: body.ghTeamId ?? null,
      },
    );
    return newId;
  });
  res.status(201).json({ id });
});

router.put("/marker-budgets/:id", requireMarkerEditor, async (req, res) => {
  const body = UpdateMarkerBudgetBody.parse(req.body);
  const row = await queryOne<{ id: number }>(
    `UPDATE dbo.M_GHMarkerAllocation
        SET Marker_Sample_Allocation_Total = @sample,
            Marker_Cost_Allocation_Total = @cost,
            Pollination_Year = @year, Berry_ID = @berry,
            Program_ID = @prog, GHLab_ID = @lab, GHTeam_ID = @team
      OUTPUT INSERTED.M_GHMarkerAllocationID AS id
      WHERE M_GHMarkerAllocationID = @id`,
    {
      id: parseInt(String(req.params.id)),
      sample: body.markerSampleAllocationTotal ?? null, cost: body.markerCostAllocationTotal ?? null,
      year: body.pollinationYear ?? null, berry: body.berryId ?? null,
      prog: body.programId ?? null, lab: body.ghLabId ?? null, team: body.ghTeamId ?? null,
    },
  );
  res.json({ id: row!.id });
});

router.delete("/marker-budgets/:id", requireMarkerEditor, async (req, res) => {
  await execute(`DELETE FROM dbo.M_GHMarkerAllocation WHERE M_GHMarkerAllocationID = @id`, { id: parseInt(String(req.params.id)) });
  res.json({ id: parseInt(String(req.params.id)), active: false });
});

// ── Genotype Screens (GHSeed.dbo.M_GHGenotypeScreen) ───────────────────

router.get("/genotype-screens", async (_req, res) => {
  const rows = await queryMany<{ id: number; genotypingScreen: string | null }>(
    `SELECT GHGenotypeScreen_ID AS id, Genotyping_Screen AS genotypingScreen
       FROM dbo.M_GHGenotypeScreen
      ORDER BY Genotyping_Screen`,
  );
  res.json(rows);
});

// ── Lab Prices (GHSeed.dbo.M_GHLabPrice) ──────────────────────────────

router.get("/lab-prices", async (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (req.query.berryId) { where.push("lp.Berry_ID = @berryId"); params.berryId = parseInt(String(req.query.berryId)); }
  if (req.query.genotypeScreenId) { where.push("lp.Genotype_Screen_ID = @gsId"); params.gsId = parseInt(String(req.query.genotypeScreenId)); }
  if (req.query.labId) { where.push("lp.GHLab_ID = @labId"); params.labId = parseInt(String(req.query.labId)); }
  if (req.query.year) { where.push("lp.Year = @year"); params.year = parseInt(String(req.query.year)); }

  const rows = await queryMany<{
    id: number; samplePrice: number | null; year: number | null;
    berryId: number | null; berry: string | null;
    genotypeScreenId: number | null; genotypingScreen: string | null;
    ghLabId: number | null; lab: string | null;
  }>(
    `SELECT lp.GHLabPrice_ID AS id, lp.Sample_Price AS samplePrice, lp.Year AS year,
            lp.Berry_ID AS berryId, b.BerryType AS berry,
            lp.Genotype_Screen_ID AS genotypeScreenId, gs.Genotyping_Screen AS genotypingScreen,
            lp.GHLab_ID AS ghLabId, l.Lab_Name AS lab
       FROM dbo.M_GHLabPrice lp
       LEFT JOIN TPN.dbo.M_BerryID b ON lp.Berry_ID = b.PK_BerryID
       LEFT JOIN dbo.M_GHGenotypeScreen gs ON lp.Genotype_Screen_ID = gs.GHGenotypeScreen_ID
       LEFT JOIN dbo.M_GHLabs l ON lp.GHLab_ID = l.GHLab_ID
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY lp.GHLabPrice_ID`,
    params,
  );
  res.json(rows.map((r) => ({
    ...r,
    berry: r.berry ?? "",
    genotypingScreen: r.genotypingScreen ?? "",
    lab: r.lab ?? "",
  })));
});

router.post("/lab-prices", requireMarkerEditor, async (req, res) => {
  const body = CreateLabPriceBody.parse(req.body);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO dbo.M_GHLabPrice
       (Sample_Price, Year, Berry_ID, Genotype_Screen_ID, GHLab_ID, Created_By, Created_DateTime)
     OUTPUT INSERTED.GHLabPrice_ID AS id
     VALUES (@price, @year, @berry, @gs, @lab, @user, GETDATE())`,
    {
      price: body.samplePrice ?? null, year: body.year ?? null,
      berry: body.berryId ?? null, gs: body.genotypeScreenId ?? null,
      lab: body.ghLabId ?? null, user: userName(req),
    },
  );
  res.status(201).json({ id: row!.id });
});

router.put("/lab-prices/:id", requireMarkerEditor, async (req, res) => {
  const body = UpdateLabPriceBody.parse(req.body);
  const row = await queryOne<{ id: number }>(
    `UPDATE dbo.M_GHLabPrice
        SET Sample_Price = @price, Year = @year, Berry_ID = @berry,
            Genotype_Screen_ID = @gs, GHLab_ID = @lab,
            Modified_By = @user, Modified_DateTime = GETDATE()
      OUTPUT INSERTED.GHLabPrice_ID AS id
      WHERE GHLabPrice_ID = @id`,
    {
      id: parseInt(String(req.params.id)),
      price: body.samplePrice ?? null, year: body.year ?? null,
      berry: body.berryId ?? null, gs: body.genotypeScreenId ?? null,
      lab: body.ghLabId ?? null, user: userName(req),
    },
  );
  res.json({ id: row!.id });
});

router.delete("/lab-prices/:id", requireMarkerEditor, async (req, res) => {
  await execute(`DELETE FROM dbo.M_GHLabPrice WHERE GHLabPrice_ID = @id`, { id: parseInt(String(req.params.id)) });
  res.json({ id: parseInt(String(req.params.id)) });
});

export default router;
