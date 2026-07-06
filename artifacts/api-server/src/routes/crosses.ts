import { Router, type IRouter, type Request } from "express";
import { queryMany, queryOne, execute, withTransaction } from "@workspace/db";
import { recalcSeedlingMaster } from "../services/recalc";
import { requireBreeder, requireBreederOnly, type AuthenticatedRequest } from "../middleware/auth";
import { BatchUpdateCrossesBody, CreateCrossBody, UpdateCrossBody } from "@workspace/api-zod";
import { scheduleTrayPipeline } from "../services/tray-pipeline";

const router: IRouter = Router();

function userName(req: Request): string {
  return (req as AuthenticatedRequest).user?.name ?? "system";
}

function toBit(v: unknown, defaultTrue = false): 0 | 1 {
  if (v === true || v === 1 || v === "1" || v === "true") return 1;
  if (v === false || v === 0 || v === "0" || v === "false") return 0;
  return defaultTrue ? 1 : 0;
}

// Resolve a destination name (e.g. "Watsonville") to its Location_ID.
async function resolveLocationId(name: string | null | undefined): Promise<number | null> {
  if (!name) return null;
  const row = await queryOne<{ id: number }>(
    `SELECT TOP 1 Location_ID AS id FROM TPN.dbo.M_Locations WHERE LocationName = @n`,
    { n: name },
  );
  return row?.id ?? null;
}

// Resolve a lab name to its GHLab_ID.
async function resolveLabId(name: string | null | undefined): Promise<number | null> {
  if (!name) return null;
  const row = await queryOne<{ id: number }>(
    `SELECT TOP 1 GHLab_ID AS id FROM dbo.M_GHLabs WHERE Lab_Name = @n`,
    { n: name },
  );
  return row?.id ?? null;
}

// Resolve a Tray_Size_ID (from M_GHTraySize) to the actual Tray_Size integer.
// M_GHSeedlingMaster.TRAY_SIZE stores the size value (e.g. 38, 50, 96), not
// the Tray_Size_ID — the form's dropdown sends the ID, so we have to translate
// here.  Without this the master row ends up with TRAY_SIZE = 1 / 2 instead
// of the real size, which throws off downstream math (trays_per_plate etc.).
async function resolveTraySizeFromId(traySizeOrId: number | null | undefined): Promise<number | null> {
  if (traySizeOrId == null) return null;
  // If the form has already sent a realistic Tray_Size value (e.g. 38, 50, 96)
  // there's nothing to translate.  Tray_Size_ID values in dev are 1, 2, 3...
  // so we conservatively look up by ID and fall back to the value itself when
  // no row matches.
  const row = await queryOne<{ size: number | null }>(
    `SELECT TOP 1 Tray_Size AS size FROM dbo.M_GHTraySize WHERE Tray_Size_ID = @id`,
    { id: traySizeOrId },
  );
  return row?.size ?? traySizeOrId;
}

// Resolve a list of marker alias names (e.g. "Vermillion", "Amethyst") to the
// matching GHMarkerLabs_ID values, optionally filtering by berry so aliases
// that exist under multiple berries (rare) map deterministically.
async function resolveMarkerIds(
  aliases: Array<string | null | undefined>,
  berryId: number | null | undefined,
): Promise<number[]> {
  const clean = aliases.map((a) => (typeof a === "string" ? a.trim() : "")).filter((a) => a.length > 0);
  if (clean.length === 0) return [];
  const placeholders = clean.map((_, i) => `@n${i}`).join(",");
  const params: Record<string, unknown> = {};
  clean.forEach((n, i) => { params[`n${i}`] = n; });
  let where = `Marker_Alias_Driscolls IN (${placeholders})`;
  if (berryId != null) {
    where += ` AND Berry_ID = @berryId`;
    params.berryId = berryId;
  }
  const rows = await queryMany<{ id: number; alias: string }>(
    `SELECT GHMarkerLabs_ID AS id, Marker_Alias_Driscolls AS alias FROM dbo.M_GHMarkerLabs WHERE ${where}`,
    params,
  );
  // Preserve the order the form supplied so Marker_1 stays Marker_1 etc.
  const byAlias = new Map(rows.map((r) => [r.alias, r.id]));
  return clean.map((a) => byAlias.get(a)).filter((id): id is number => typeof id === "number");
}

// Replace the marker rows for a single seedling master.  Used by both POST
// (insert) and PUT (edit) — the form's `marker1..marker6` fields hold alias
// names that map to T_GHProgenyMarkers child rows.  We always delete first
// so re-saving with a different set of markers works.
async function syncProgenyMarkers(
  tx: { execute: (q: string, p?: Record<string, unknown>) => Promise<unknown> },
  ghsmId: number,
  markerIds: number[],
  user: string,
): Promise<void> {
  await tx.execute(
    `DELETE FROM dbo.T_GHProgenyMarkers WHERE ghsm_FK = @id`,
    { id: ghsmId },
  );
  for (const mid of markerIds) {
    await tx.execute(
      `INSERT INTO dbo.T_GHProgenyMarkers (Marker_ID, ghsm_FK, Created_By, Created_DateTime, Modified_By, Modified_DateTime)
       VALUES (@mid, @gid, @user, GETDATE(), @user, GETDATE())`,
      { mid, gid: ghsmId, user },
    );
  }
}

// Resolve the four FK columns the recalc proc relies on.  The Excel-upload
// pipeline (sp_GH_SeedlingMaster_Transform_Load_Pipeline) populates these
// before INSERT; the form/copy flow must do the same — without them the
// proc's WHERE clauses fail and required-amount columns stay null/stale.
//
//   GHRatios_FK     ← (Berry_ID, Team_ID, D1_Program_ID)
//   Deadlines_FK    ← (Berry_ID, Team_ID, D1_Program_ID, Destination1_ID)
//   P1_Selection_ID ← (Berry_ID, Team_ID, Pollination_Year, Parent1 name)
//   P2_Selection_ID ← (Berry_ID, Team_ID, Pollination_Year, Parent2 name)
async function resolveCrossFks(input: {
  berryId: number | null | undefined;
  teamId: number | null | undefined;
  d1ProgramId: number | null | undefined;
  destination1Id: number | null | undefined;
  pollinationYear: number | null | undefined;
  parent1: string | null | undefined;
  parent2: string | null | undefined;
}): Promise<{
  ghRatiosId: number | null;
  deadlinesId: number | null;
  p1SelectionId: number | null;
  p2SelectionId: number | null;
}> {
  const ratiosRow =
    input.berryId && input.teamId && input.d1ProgramId
      ? await queryOne<{ id: number }>(
          `SELECT TOP 1 GHRatios_ID AS id
             FROM dbo.M_GHRatios
            WHERE Berry_ID = @berryId AND Team_ID = @teamId AND Program_ID = @progId
              AND Active = 1`,
          { berryId: input.berryId, teamId: input.teamId, progId: input.d1ProgramId },
        )
      : null;

  const deadlinesRow =
    input.berryId && input.teamId && input.d1ProgramId && input.destination1Id
      ? await queryOne<{ id: number }>(
          `SELECT TOP 1 Deadlines_ID AS id
             FROM dbo.M_GHDeadlines
            WHERE Berry_ID = @berryId AND Team_ID = @teamId
              AND Program_ID = @progId AND Destination_ID = @destId
              AND Active = 1`,
          {
            berryId: input.berryId, teamId: input.teamId,
            progId: input.d1ProgramId, destId: input.destination1Id,
          },
        )
      : null;

  const p1Row =
    input.berryId && input.teamId && input.pollinationYear && input.parent1
      ? await queryOne<{ id: number }>(
          `SELECT TOP 1 GHParentInventory_ID AS id
             FROM dbo.T_GHParentInventory2
            WHERE Berry_ID = @berryId AND Team_ID = @teamId
              AND Pollination_Year = @py AND Selection = @sel`,
          {
            berryId: input.berryId, teamId: input.teamId,
            py: input.pollinationYear, sel: input.parent1,
          },
        )
      : null;

  const p2Row =
    input.berryId && input.teamId && input.pollinationYear && input.parent2
      ? await queryOne<{ id: number }>(
          `SELECT TOP 1 GHParentInventory_ID AS id
             FROM dbo.T_GHParentInventory2
            WHERE Berry_ID = @berryId AND Team_ID = @teamId
              AND Pollination_Year = @py AND Selection = @sel`,
          {
            berryId: input.berryId, teamId: input.teamId,
            py: input.pollinationYear, sel: input.parent2,
          },
        )
      : null;

  return {
    ghRatiosId: ratiosRow?.id ?? null,
    deadlinesId: deadlinesRow?.id ?? null,
    p1SelectionId: p1Row?.id ?? null,
    p2SelectionId: p2Row?.id ?? null,
  };
}

// ── Shape a row from vw_GH_CrossesDesk (aliased camelCase) to API JSON ─

interface CrossesDeskRow {
  id: number;
  progeny: string | null;
  parent1: string | null;
  parent2: string | null;
  bulkParent3: string | null;
  destination1: string | null;
  destination2: string | null;
  d1Program: string | null;
  d2Program: string | null;
  d1SeedlingShipRequest: number | null;
  d2SeedlingShipRequest: number | null;
  breederRequestedShipDest1Adjustments: number | null;
  breederRequestedShipDest2Adjustments: number | null;
  d1TransplantAdjustment: number | null;
  d2TransplantAdjustment: number | null;
  breederAdjustmentDate: Date | null;
  suggestedLowShipQtyAdj: number | null;
  suggestedHighShipQtyAdj: number | null;
  totalSeedlingShipRequestCalc: number | null;
  estimatedPlantsToShip: number | null;
  seedWtToSeedlingShip: number | null;
  shipTotalActual: number | null;
  d1FieldPlantDate: Date | null;
  d2FieldPlantDate: Date | null;
  requestedFieldPlantYear: number | null;
  expectedDiscardPercentage: number | null;
  spinelessDiscardPercentage: number | null;
  transplantInstructions: string | null;
  transplantsRequired: number | null;
  plantNumTransplanted: number | null;
  extraTransplants: number | null;
  traySize: number | null;
  traysRequestedCalc: number | null;
  screening: boolean | null;
  sortByMarkerGroup: boolean | null;
  testingLab1: string | null;
  testingLab2: string | null;
  totalMarker: number | null;
  marker1: string | null; marker2: string | null; marker3: string | null;
  marker4: string | null; marker5: string | null; marker6: string | null;
  spCrosses: boolean | null;
  pollinationYear: number | null;
  p1TotalParentsRequired: number | null;
  p1TotalParents: number | null;
  p1L1: string | null; p1L1fc: string | null; p1L2: string | null; p1L2fc: string | null;
  p1L3: string | null; p1L3fc: string | null; p1L4: string | null; p1L4fc: string | null;
  p2TotalParentsRequired: number | null;
  p2TotalParents: number | null;
  p2L1: string | null; p2L1fc: string | null; p2L2: string | null; p2L2fc: string | null;
  p2L3: string | null; p2L3fc: string | null; p2L4: string | null; p2L4fc: string | null;
  reciprocalAllowed: boolean | null;
  sowSeed: boolean | null;
  seedWeightRequired: number | null;
  seedWeightInventory: number | null;
  totalSeedWeightSown: number | null;
  fruitRequired: number | null;
  totalFruitCollected: number | null;
  flowersToPollinateRequired: number | null;
  successfulPollinations: number | null;
  flowersRequiredForPollen: number | null;
  reciprocalDone: boolean | null;
  totalFlowersCollected: number | null;
  goodFlowersCollected: number | null;
  newLabels: boolean | null;
  breederComments: string | null;
  ghTeamComments: string | null;
  fumigated: boolean | null;
  berry: string | null;
  teamName: string | null;
  crossDesignedBy: string | null;
  active: boolean | null;
  parentMatch: boolean | null;
  seedWtFlagBit: boolean | null;
  estimatedPlantsFlagBit: boolean | null;
  p1FlagBit: boolean | null;
  p2FlagBit: boolean | null;
  berryId: number | null;
  teamId: number | null;
  d1ProgramId: number | null;
  d2ProgramId: number | null;
  destinationId1: number | null;
  destinationId2: number | null;
}

// The column list reused in list + detail queries.  Aliases camelCase for JS
// consumption.  Joins M_GHSeedlingMaster to fetch the FK IDs the view omits.
// Light column set — always returned by GET /crosses.  Drops the per-marker
// (Marker_1..6) and per-parent-inventory (P1L1..L4 / P2L1..L4 / *FC) columns
// because each of them backs onto a separate CTE/JOIN inside vw_GH_CrossesDesk
// that adds substantial cost when 1,000+ rows are returned.  Profiling on a
// 1,263-row Pollination_Year=2025 result:
//   Lite cols (this set):    ~1.0 s end-to-end via the mssql driver.
//   Full set (cols + heavy): ~16 s — 15x slower.
// Short list page only shows the AGGREGATE versions (totalMarker,
// p1TotalParents, p2TotalParents) so it gets by on the lite set.
const CROSS_SELECT_COLS_LITE = `
  v.GHSeedlingMaster_ID AS id,
  v.Progeny AS progeny,
  v.PARENT1 AS parent1, v.PARENT2 AS parent2, v.BULK_PARENT3 AS bulkParent3,
  v.DESTINATION1 AS destination1, v.DESTINATION2 AS destination2,
  v.D1_Program AS d1Program, v.D2_Program AS d2Program,
  v.D1_SEEDLING_SHIP_REQUEST AS d1SeedlingShipRequest,
  v.D2_SEEDLING_SHIP_REQUEST AS d2SeedlingShipRequest,
  v.Breeder_Requested_ShipDest1_Adjustments AS breederRequestedShipDest1Adjustments,
  v.Breeder_Requested_ShipDest2_Adjustments AS breederRequestedShipDest2Adjustments,
  m.D1_Transplant_Adjustment AS d1TransplantAdjustment,
  m.D2_Transplant_Adjustment AS d2TransplantAdjustment,
  v.Breeder_Adjustment_Date AS breederAdjustmentDate,
  v.Suggested_Low_Ship_Qty_Adj AS suggestedLowShipQtyAdj,
  v.Suggested_High_Ship_Qty_Adj AS suggestedHighShipQtyAdj,
  v.TOTAL_SEEDLING_SHIP_REQUEST_Calc AS totalSeedlingShipRequestCalc,
  v.Estimated_Plants_To_Ship AS estimatedPlantsToShip,
  v.Seed_Wt_To_Seedling_Ship AS seedWtToSeedlingShip,
  v.Ship_Total_Actual AS shipTotalActual,
  v.D1_FIELD_PLANT_DATE AS d1FieldPlantDate,
  v.D2_FIELD_PLANT_DATE AS d2FieldPlantDate,
  v.REQUESTED_FIELD_PLANT_YEAR AS requestedFieldPlantYear,
  v.EXPECTED_DISCARD_PERCENTAGE AS expectedDiscardPercentage,
  v.SPINELESS_DISCARD_PERCENTAGE AS spinelessDiscardPercentage,
  v.TRANSPLANT_INSTRUCTIONS AS transplantInstructions,
  v.TRANSPLANTS_REQUIRED AS transplantsRequired,
  v.Plant_Num_Transplanted AS plantNumTransplanted,
  v.Extra_Transplants AS extraTransplants,
  v.TRAY_SIZE AS traySize,
  v.Trays_Requested_Calc AS traysRequestedCalc,
  v.SCREENING AS screening, v.SORT_BY_MARKER_GROUP AS sortByMarkerGroup,
  v.Testing_Lab_1 AS testingLab1, v.Testing_Lab_2 AS testingLab2,
  v.Total_Marker AS totalMarker,
  v.SP_Crosses AS spCrosses, v.Pollination_Year AS pollinationYear,
  v.P1_TOTAL_PARENTS_REQUIRED AS p1TotalParentsRequired,
  v.P1_Total_Parents AS p1TotalParents,
  v.P2_TOTAL_PARENTS_REQUIRED AS p2TotalParentsRequired,
  v.P2_Total_Parents AS p2TotalParents,
  v.RECIPROCAL_ALLOWED AS reciprocalAllowed, v.SOW_SEED AS sowSeed,
  v.SEED_WEIGHT_REQUIRED AS seedWeightRequired,
  v.Seed_Weight_Inventory AS seedWeightInventory,
  v.Total_Seed_Weight_Sown AS totalSeedWeightSown,
  v.FRUIT_REQUIRED AS fruitRequired,
  v.Total_Fruit_Collected AS totalFruitCollected,
  v.FLOWERS_TO_POLLINATE_REQUIRED AS flowersToPollinateRequired,
  v.Successful_Pollinations AS successfulPollinations,
  v.FLOWERS_REQUIRED_FOR_POLLEN AS flowersRequiredForPollen,
  v.Reciprocal_Done AS reciprocalDone,
  v.New_Labels AS newLabels,
  v.BREEDER_COMMENTS AS breederComments, v.GH_TEAM_COMMENTS AS ghTeamComments,
  v.Fumigated AS fumigated,
  v.Berry AS berry, v.Team_Name AS teamName,
  v.CROSS_DESIGNED_BY AS crossDesignedBy,
  v.Active AS active,
  v.Parent_Match AS parentMatch,
  v.Seed_Wt_Flag_BIT AS seedWtFlagBit,
  v.Estimated_Plants_Flag_BIT AS estimatedPlantsFlagBit,
  v.P1_Flag_BIT AS p1FlagBit, v.P2_Flag_BIT AS p2FlagBit,
  m.Berry_ID AS berryId, m.Team_ID AS teamId,
  m.D1_PROGRAM_FK AS d1ProgramId, m.D2_PROGRAM_FK AS d2ProgramId,
  m.DESTINATION1_FK AS destinationId1, m.DESTINATION2_FK AS destinationId2`;

// Heavy columns appended only when ?detail=full.  Used by the Full list page
// and the GET /crosses/:id detail endpoint.
const CROSS_SELECT_COLS_HEAVY = `,
  v.Marker_1 AS marker1, v.Marker_2 AS marker2, v.Marker_3 AS marker3,
  v.Marker_4 AS marker4, v.Marker_5 AS marker5, v.Marker_6 AS marker6,
  v.P1L1 AS p1L1, v.P1L1FC AS p1L1fc, v.P1L2 AS p1L2, v.P1L2FC AS p1L2fc,
  v.P1L3 AS p1L3, v.P1L3FC AS p1L3fc, v.P1L4 AS p1L4, v.P1L4FC AS p1L4fc,
  v.P2L1 AS p2L1, v.P2L1FC AS p2L1fc, v.P2L2 AS p2L2, v.P2L2FC AS p2L2fc,
  v.P2L3 AS p2L3, v.P2L3FC AS p2L3fc, v.P2L4 AS p2L4, v.P2L4FC AS p2L4fc,
  v.Total_Flowers_Collected AS totalFlowersCollected,
  v.Good_Flowers_Collected AS goodFlowersCollected`;

const CROSS_SELECT_COLS_FULL = CROSS_SELECT_COLS_LITE + CROSS_SELECT_COLS_HEAVY;

// Back-compat alias: anywhere that historically used CROSS_SELECT_COLS keeps
// the full set so detail/edit endpoints don't accidentally lose data.
const CROSS_SELECT_COLS = CROSS_SELECT_COLS_FULL;

const CROSS_FROM = `
  FROM dbo.vw_GH_CrossesDesk v
  INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID`;

function mapCrossRow(r: CrossesDeskRow) {
  return {
    id: r.id,
    progeny: r.progeny,
    parent1: r.parent1, parent2: r.parent2, bulkParent3: r.bulkParent3,
    destination1: r.destination1, destination2: r.destination2,
    d1Program: r.d1Program, d2Program: r.d2Program,
    d1ProgramId: r.d1ProgramId, d2ProgramId: r.d2ProgramId,
    d1SeedlingShipRequest: r.d1SeedlingShipRequest,
    d2SeedlingShipRequest: r.d2SeedlingShipRequest,
    breederRequestedShipDest1Adjustments: r.breederRequestedShipDest1Adjustments,
    breederRequestedShipDest2Adjustments: r.breederRequestedShipDest2Adjustments,
    d1TransplantAdjustment: r.d1TransplantAdjustment,
    d2TransplantAdjustment: r.d2TransplantAdjustment,
    breederAdjustmentDate: r.breederAdjustmentDate?.toISOString() ?? null,
    suggestedLowShipQtyAdj: r.suggestedLowShipQtyAdj,
    suggestedHighShipQtyAdj: r.suggestedHighShipQtyAdj,
    totalSeedlingShipRequestCalc: r.totalSeedlingShipRequestCalc,
    shipTotalActual: r.shipTotalActual,
    d1FieldPlantDate: r.d1FieldPlantDate?.toISOString() ?? null,
    d2FieldPlantDate: r.d2FieldPlantDate?.toISOString() ?? null,
    requestedFieldPlantYear: r.requestedFieldPlantYear,
    estimatedPlantsToShip: r.estimatedPlantsToShip,
    seedWtToSeedlingShip: r.seedWtToSeedlingShip,
    expectedDiscardPercentage: r.expectedDiscardPercentage,
    spinelessDiscardPercentage: r.spinelessDiscardPercentage,
    transplantInstructions: r.transplantInstructions,
    transplantsRequired: r.transplantsRequired,
    plantNumTransplanted: r.plantNumTransplanted,
    extraTransplants: r.extraTransplants,
    traySize: r.traySize, traysRequestedCalc: r.traysRequestedCalc,
    screening: r.screening === true,
    sortByMarkerGroup: r.sortByMarkerGroup === true,
    testingLab1: r.testingLab1, testingLab2: r.testingLab2,
    totalMarker: r.totalMarker,
    // Heavy fields — undefined when the route was called without ?detail=full.
    // Coalesce to null so the JSON shape stays predictable for clients.
    marker1: r.marker1 ?? null, marker2: r.marker2 ?? null, marker3: r.marker3 ?? null,
    marker4: r.marker4 ?? null, marker5: r.marker5 ?? null, marker6: r.marker6 ?? null,
    spCrosses: r.spCrosses === true,
    pollinationYear: r.pollinationYear,
    p1TotalParentsRequired: r.p1TotalParentsRequired,
    p1TotalParents: r.p1TotalParents,
    p1L1: r.p1L1 ?? null, p1L1fc: r.p1L1fc ?? null, p1L2: r.p1L2 ?? null, p1L2fc: r.p1L2fc ?? null,
    p1L3: r.p1L3 ?? null, p1L3fc: r.p1L3fc ?? null, p1L4: r.p1L4 ?? null, p1L4fc: r.p1L4fc ?? null,
    p2TotalParentsRequired: r.p2TotalParentsRequired,
    p2TotalParents: r.p2TotalParents,
    p2L1: r.p2L1 ?? null, p2L1fc: r.p2L1fc ?? null, p2L2: r.p2L2 ?? null, p2L2fc: r.p2L2fc ?? null,
    p2L3: r.p2L3 ?? null, p2L3fc: r.p2L3fc ?? null, p2L4: r.p2L4 ?? null, p2L4fc: r.p2L4fc ?? null,
    reciprocalAllowed: r.reciprocalAllowed === true,
    sowSeed: r.sowSeed === true,
    seedWeightRequired: r.seedWeightRequired,
    seedWeightInventory: r.seedWeightInventory,
    totalSeedWeightSown: r.totalSeedWeightSown,
    fruitRequired: r.fruitRequired,
    totalFruitCollected: r.totalFruitCollected,
    flowersToPollinateRequired: r.flowersToPollinateRequired,
    successfulPollinations: r.successfulPollinations,
    flowersRequiredForPollen: r.flowersRequiredForPollen,
    reciprocalDone: r.reciprocalDone === true,
    totalFlowersCollected: r.totalFlowersCollected ?? null,
    goodFlowersCollected: r.goodFlowersCollected ?? null,
    newLabels: r.newLabels === true,
    breederComments: r.breederComments,
    ghTeamComments: r.ghTeamComments,
    fumigated: r.fumigated === true,
    berry: r.berry, berryId: r.berryId,
    teamName: r.teamName, teamId: r.teamId,
    crossDesignedBy: r.crossDesignedBy,
    active: r.active === true,
    parentMatch: r.parentMatch === true,
    seedWtFlagBit: r.seedWtFlagBit === true,
    estimatedPlantsFlagBit: r.estimatedPlantsFlagBit === true,
    p1FlagBit: r.p1FlagBit === true, p2FlagBit: r.p2FlagBit === true,
    // Fields not in the view — return null to keep response shape stable:
    seedWeightAcidTreated: null,
    seedWeightVariance: null,
    seedAcidWeightVariance: null,
    acidTreatAll: false,
    seedReadyForAcid: false,
    acidInDateRange: false,
    acidStartDate: null,
    acidDeadlineDate: null,
    seedWeightToSow: null,
    seedWeightToBank: null,
    seedSowToGo: null,
    plantNumTransAlAzar: null,
    plantNumTransSpineless: null,
    plantNumTransSpiny: null,
  };
}

// ── Filter builder ─────────────────────────────────────────────────────

function buildFilters(query: Record<string, unknown>): { where: string; params: Record<string, unknown> } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.berryId) { where.push("m.Berry_ID = @berryId"); params.berryId = parseInt(String(query.berryId)); }
  if (query.teamId) { where.push("m.Team_ID = @teamId"); params.teamId = parseInt(String(query.teamId)); }
  if (query.pollinationYear) { where.push("v.Pollination_Year = @py"); params.py = parseInt(String(query.pollinationYear)); }
  if (query.spCrosses === "true") where.push("v.SP_Crosses = 1");
  if (query.progeny) { where.push("v.Progeny LIKE @progeny"); params.progeny = `%${String(query.progeny)}%`; }

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
  if (query.destinationId) {
    const dids = String(query.destinationId).split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (dids.length > 0) {
      const clauses = dids.map((did, i) => {
        params[`dest${i}`] = did;
        return `(m.DESTINATION1_FK = @dest${i} OR m.DESTINATION2_FK = @dest${i})`;
      });
      where.push(`(${clauses.join(" OR ")})`);
    }
  }
  if (query.parent) {
    where.push("(v.PARENT1 LIKE @parent OR v.PARENT2 LIKE @parent)");
    params.parent = `%${String(query.parent)}%`;
  }
  if (query.active === "true") where.push("v.Active = 1");
  if (query.active === "false") where.push("v.Active = 0");
  if (query.fumigated === "true") where.push("v.Fumigated = 1");
  if (query.fruitToGo === "true") where.push("(COALESCE(v.Successful_Pollinations, 0) - COALESCE(v.Total_Fruit_Collected, 0)) > 0");
  if (query.pollinationToGo === "true") where.push("(COALESCE(v.FLOWERS_TO_POLLINATE_REQUIRED, 0) - COALESCE(v.Successful_Pollinations, 0)) > 0");
  if (query.sowSeed === "true") where.push("v.SOW_SEED = 1");
  if (query.sowSeed === "false") where.push("v.SOW_SEED = 0");
  // Fields not in the view — silently skip:
  // seedSowToGo, acidInDateRange, availablePlants (extraTransplants > 0 — that one IS in view)
  if (query.availablePlants === "true") where.push("COALESCE(v.Extra_Transplants, 0) > 0");

  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const SORT_COLUMNS: Record<string, string> = {
  progeny: "v.Progeny",
  d1Program: "v.D1_Program",
  destination1: "v.DESTINATION1",
  d1ShipRequest: "v.D1_SEEDLING_SHIP_REQUEST",
  d1ShipAdj: "v.Breeder_Requested_ShipDest1_Adjustments",
  destination2: "v.DESTINATION2",
  d2ShipRequest: "v.D2_SEEDLING_SHIP_REQUEST",
  d2ShipAdj: "v.Breeder_Requested_ShipDest2_Adjustments",
  totalShipRequest: "v.TOTAL_SEEDLING_SHIP_REQUEST_Calc",
  expectedDiscard: "v.EXPECTED_DISCARD_PERCENTAGE",
  transplantsRequired: "v.TRANSPLANTS_REQUIRED",
  pollinationYear: "v.Pollination_Year",
  parent1: "v.PARENT1",
  parent2: "v.PARENT2",
};

// ── GET /crosses ──────────────────────────────────────────────────────

router.get("/crosses", async (req, res) => {
  try {
    const page = parseInt(String(req.query.page)) || 1;
    const pageSize = Math.min(parseInt(String(req.query.pageSize)) || 25, 5000);
    const offset = (page - 1) * pageSize;

    const { where, params } = buildFilters(req.query as Record<string, unknown>);
    const sortCol = SORT_COLUMNS[String(req.query.sortBy)] || "v.Progeny";
    const sortDir = req.query.sortDir === "desc" ? "DESC" : "ASC";

    // detail=full → include marker_1..6 + P1/P2 inventory L1-L4 + flowers
    // collected.  Defaults to lite (drops them) — saves ~15s on a 1.2k row
    // page.  See CROSS_SELECT_COLS_LITE for the explanation.
    const wantFull = String(req.query.detail || "lite").toLowerCase() === "full";
    const cols = wantFull ? CROSS_SELECT_COLS_FULL : CROSS_SELECT_COLS_LITE;

    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total ${CROSS_FROM} ${where}`,
      params,
    );
    const total = countRow?.total ?? 0;

    const rows = await queryMany<CrossesDeskRow>(
      `SELECT ${cols} ${CROSS_FROM} ${where}
       ORDER BY ${sortCol} ${sortDir}
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize },
    );

    res.json({
      data: rows.map(mapCrossRow),
      total, page, pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── GET /crosses/totals ───────────────────────────────────────────────

router.get("/crosses/totals", async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query as Record<string, unknown>);
    const row = await queryOne<Record<string, number>>(
      `SELECT
         COUNT(*) AS [rowCount],
         COALESCE(SUM(v.D1_SEEDLING_SHIP_REQUEST), 0) AS d1ShipRequest,
         COALESCE(SUM(v.Breeder_Requested_ShipDest1_Adjustments), 0) AS d1ShipAdj,
         COALESCE(SUM(v.D2_SEEDLING_SHIP_REQUEST), 0) AS d2ShipRequest,
         COALESCE(SUM(v.Breeder_Requested_ShipDest2_Adjustments), 0) AS d2ShipAdj,
         COALESCE(SUM(v.TOTAL_SEEDLING_SHIP_REQUEST_Calc), 0) AS totalShipRequest,
         COALESCE(SUM(v.Estimated_Plants_To_Ship), 0) AS estimatedPlantsToShip,
         COALESCE(SUM(v.Seed_Wt_To_Seedling_Ship), 0) AS seedWtToSeedlingShip,
         COALESCE(SUM(v.TRANSPLANTS_REQUIRED), 0) AS transplantsRequired,
         COALESCE(SUM(v.Extra_Transplants), 0) AS extraTransplants,
         COALESCE(SUM(v.Total_Seed_Weight_Sown), 0) AS seedWtSown,
         COALESCE(SUM(v.SEED_WEIGHT_REQUIRED), 0) AS seedRequired,
         COALESCE(SUM(v.Seed_Weight_Inventory), 0) AS seedInventory,
         COALESCE(SUM(v.FLOWERS_TO_POLLINATE_REQUIRED), 0) AS flowersToPollinateRequired,
         COALESCE(SUM(v.Successful_Pollinations), 0) AS successfulPollinations,
         COALESCE(SUM(v.P1_Total_Parents), 0) AS p1TotalParents,
         COALESCE(SUM(v.P1_TOTAL_PARENTS_REQUIRED), 0) AS p1ParentsRequired,
         COALESCE(SUM(v.P2_Total_Parents), 0) AS p2TotalParents,
         COALESCE(SUM(v.P2_TOTAL_PARENTS_REQUIRED), 0) AS p2ParentsRequired,
         COALESCE(AVG(v.EXPECTED_DISCARD_PERCENTAGE), 0) AS avgExpectedDiscard,
         COALESCE(SUM(CAST(v.Reciprocal_Done AS INT)), 0) AS reciprocalDone,
         COALESCE(SUM(v.FRUIT_REQUIRED), 0) AS fruitRequired,
         COALESCE(SUM(v.Total_Fruit_Collected), 0) AS totalFruitCollected,
         COALESCE(SUM(COALESCE(v.Successful_Pollinations, 0) - COALESCE(v.Total_Fruit_Collected, 0)), 0) AS fruitToGo
       ${CROSS_FROM} ${where}`,
      params,
    );
    res.json(row ?? {});
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── PATCH /crosses/batch ──────────────────────────────────────────────
// Inline edits from the list pages.  All updates go to M_GHSeedlingMaster.
//
// IMPORTANT: vw_GH_CrossesDesk derives the destination name from a JOIN on
// DESTINATION{1,2}_FK → M_Locations.LocationName, NOT from the base DESTINATION
// columns.  So when a user changes a destination in the inline editor, we
// must resolve the new name to its Location_ID and update the *_FK columns
// (we keep the name columns in sync too for consistency).

const BATCH_FIELD_MAP: Record<string, string> = {
  // destination1/2 are handled separately below — they require name→FK lookup.
  breederRequestedShipDest1Adjustments: "Breeder_Requested_ShipDest1_Adjustments",
  breederRequestedShipDest2Adjustments: "Breeder_Requested_ShipDest2_Adjustments",
  expectedDiscardPercentage: "EXPECTED_DISCARD_PERCENTAGE",
  spinelessDiscardPercentage: "SPINELESS_DISCARD_PERCENTAGE",
  breederComments: "BREEDER_COMMENTS",
  ghTeamComments: "GH_TEAM_COMMENTS",
  reciprocalDone: "RECIPROCAL_DONE",
};

router.patch("/crosses/batch", requireBreeder, async (req, res) => {
  try {
    const { updates } = BatchUpdateCrossesBody.parse(req.body);
    const user = userName(req);
    let updatedCount = 0;

    // Build a single name→ID lookup for all destinations referenced in this batch.
    const destNames = new Set<string>();
    for (const u of updates) {
      const u1 = (u as Record<string, unknown>).destination1;
      const u2 = (u as Record<string, unknown>).destination2;
      if (typeof u1 === "string" && u1) destNames.add(u1);
      if (typeof u2 === "string" && u2) destNames.add(u2);
    }
    const destNameToId = new Map<string, number>();
    if (destNames.size > 0) {
      const namesArr = Array.from(destNames);
      const params: Record<string, unknown> = {};
      const placeholders = namesArr.map((n, i) => {
        params[`n${i}`] = n;
        return `@n${i}`;
      });
      const rows = await queryMany<{ id: number; name: string }>(
        `SELECT Location_ID AS id, LocationName AS name
           FROM TPN.dbo.M_Locations WHERE LocationName IN (${placeholders.join(",")})`,
        params,
      );
      for (const r of rows) destNameToId.set(r.name, r.id);
    }

    await withTransaction(async (tx) => {
      for (const u of updates) {
        const sets: string[] = [];
        const p: Record<string, unknown> = { id: u.id, user };

        for (const [apiKey, dbCol] of Object.entries(BATCH_FIELD_MAP)) {
          const v = (u as Record<string, unknown>)[apiKey];
          if (v === undefined) continue;
          const pkey = `v_${apiKey}`;
          sets.push(`${dbCol} = @${pkey}`);
          // Booleans (reciprocalDone) must go in as bit
          p[pkey] = typeof v === "boolean" ? (v ? 1 : 0) : v;
        }

        // Destinations: resolve name→FK and update both columns.  An empty
        // string clears both name and FK.
        const dest1 = (u as Record<string, unknown>).destination1;
        if (dest1 !== undefined) {
          const name = typeof dest1 === "string" ? dest1.trim() : "";
          sets.push("DESTINATION1 = @v_dest1Name", "DESTINATION1_FK = @v_dest1Id");
          p.v_dest1Name = name || null;
          p.v_dest1Id = name ? destNameToId.get(name) ?? null : null;
        }
        const dest2 = (u as Record<string, unknown>).destination2;
        if (dest2 !== undefined) {
          const name = typeof dest2 === "string" ? dest2.trim() : "";
          sets.push("DESTINATION2 = @v_dest2Name", "DESTINATION2_FK = @v_dest2Id");
          p.v_dest2Name = name || null;
          p.v_dest2Id = name ? destNameToId.get(name) ?? null : null;
        }

        // totalFruitCollected — not in base table (view aggregates from elsewhere), skip
        if (sets.length === 0) continue;
        sets.push("Modified_Date = GETDATE()", "Modified_By = @user");
        await tx.execute(
          `UPDATE dbo.M_GHSeedlingMaster SET ${sets.join(", ")} WHERE GHSeedlingMaster_ID = @id`,
          p,
        );
        updatedCount++;
      }
    });

    await recalcSeedlingMaster();
    scheduleTrayPipeline();
    res.json({ updatedCount });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── GET /crosses/:id ──────────────────────────────────────────────────

router.get("/crosses/:id", async (req, res) => {
  try {
    const row = await queryOne<CrossesDeskRow>(
      `SELECT ${CROSS_SELECT_COLS} ${CROSS_FROM} WHERE v.GHSeedlingMaster_ID = @id`,
      { id: parseInt(String(req.params.id)) },
    );
    if (!row) { res.status(404).json({ message: "Cross not found" }); return; }
    res.json(mapCrossRow(row));
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── POST /crosses ─────────────────────────────────────────────────────

router.post("/crosses", requireBreeder, async (req, res) => {
  try {
    const body = CreateCrossBody.parse(req.body);
    if (body.progeny) {
      const existing = await queryOne<{ id: number }>(
        `SELECT TOP 1 GHSeedlingMaster_ID AS id FROM dbo.M_GHSeedlingMaster WHERE PROGENY = @p`,
        { p: body.progeny },
      );
      if (existing) { res.status(400).json({ message: "Progeny name already exists in DB." }); return; }
    }

    const dest1Id = await resolveLocationId(body.destination1);
    const dest2Id = await resolveLocationId(body.destination2);
    const lab1Id = await resolveLabId(body.testingLab1);
    const lab2Id = await resolveLabId(body.testingLab2);
    const traySize = await resolveTraySizeFromId(body.traySize);
    const fks = await resolveCrossFks({
      berryId: body.berryId, teamId: body.teamId,
      d1ProgramId: body.d1ProgramId, destination1Id: dest1Id,
      pollinationYear: body.pollinationYear,
      parent1: body.parent1, parent2: body.parent2,
    });
    const markerIds = await resolveMarkerIds(
      [body.marker1, body.marker2, body.marker3, body.marker4, body.marker5, body.marker6],
      body.berryId,
    );

    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO dbo.M_GHSeedlingMaster
         (PROGENY, PARENT1, PARENT2, BULK_PARENT3, CROSS_DESIGNED_BY,
          Berry_ID, Team_ID, Pollination_Year,
          DESTINATION1, DESTINATION1_FK, DESTINATION2, DESTINATION2_FK,
          D1_PROGRAM_FK, D2_PROGRAM_FK,
          D1_SEEDLING_SHIP_REQUEST, D2_SEEDLING_SHIP_REQUEST,
          Breeder_Requested_ShipDest1_Adjustments, Breeder_Requested_ShipDest2_Adjustments,
          D1_FIELD_PLANT_DATE, D2_FIELD_PLANT_DATE,
          EXPECTED_DISCARD_PERCENTAGE, SPINELESS_DISCARD_PERCENTAGE,
          TRANSPLANT_INSTRUCTIONS, TRAY_SIZE, SCREENING, SORT_BY_MARKER_GROUP,
          Testing_Lab_1_FK, Testing_Lab_2_FK,
          Total_Markers,
          SP_Crosses, RECIPROCAL_ALLOWED, SOW_SEED, Fumigated,
          BREEDER_COMMENTS, GH_TEAM_COMMENTS,
          GHRatios_FK, Deadlines_FK, P1_Selection_ID, P2_Selection_ID,
          ACTIVE, Created_By, Created_Date)
       OUTPUT INSERTED.GHSeedlingMaster_ID AS id
       VALUES
         (@progeny, @parent1, @parent2, @bulk3, @designedBy,
          @berryId, @teamId, @py,
          @dest1Name, @dest1, @dest2Name, @dest2,
          @d1prog, @d2prog,
          @d1ship, @d2ship, @d1adj, @d2adj,
          @d1Date, @d2Date,
          @expDiscard, @spineless,
          @transInstr, @tray, @screening, @sortMk,
          @lab1, @lab2,
          @totalMk,
          @sp, @recip, @sow, @fum,
          @brcm, @ghcm,
          @ratiosFk, @deadlinesFk, @p1sel, @p2sel,
          @active, @user, GETDATE())`,
      {
        progeny: body.progeny ?? null,
        parent1: body.parent1 ?? null, parent2: body.parent2 ?? null,
        bulk3: body.bulkParent3 ?? null,
        designedBy: body.crossDesignedBy ?? null,
        berryId: body.berryId ?? null, teamId: body.teamId ?? null,
        py: body.pollinationYear ?? null,
        dest1Name: body.destination1 ?? null, dest1: dest1Id,
        dest2Name: body.destination2 ?? null, dest2: dest2Id,
        d1prog: body.d1ProgramId ?? null, d2prog: body.d2ProgramId ?? null,
        d1ship: body.d1SeedlingShipRequest ?? null, d2ship: body.d2SeedlingShipRequest ?? null,
        d1adj: body.breederRequestedShipDest1Adjustments ?? null,
        d2adj: body.breederRequestedShipDest2Adjustments ?? null,
        d1Date: body.d1FieldPlantDate ? new Date(body.d1FieldPlantDate) : null,
        d2Date: body.d2FieldPlantDate ? new Date(body.d2FieldPlantDate) : null,
        // REQUESTED_FIELD_PLANT_YEAR intentionally omitted — calculated server-side.
        expDiscard: body.expectedDiscardPercentage ?? null,
        spineless: body.spinelessDiscardPercentage ?? null,
        transInstr: body.transplantInstructions ?? null,
        // TRAY_SIZE column holds the actual size value (e.g. 38, 50), not the
        // Tray_Size_ID the form sends.  resolveTraySizeFromId maps it.
        tray: traySize ?? null,
        screening: toBit(body.screening),
        sortMk: toBit(body.sortByMarkerGroup),
        lab1: lab1Id, lab2: lab2Id,
        // Total_Markers reflects the count of resolved markers, not whatever
        // the client computed — keeps the master row consistent with the
        // T_GHProgenyMarkers child rows we're about to insert.
        totalMk: markerIds.length,
        sp: toBit(body.spCrosses),
        recip: toBit(body.reciprocalAllowed),
        sow: toBit(body.sowSeed, true),
        fum: toBit(body.fumigated),
        brcm: body.breederComments ?? null,
        ghcm: body.ghTeamComments ?? null,
        ratiosFk: fks.ghRatiosId, deadlinesFk: fks.deadlinesId,
        p1sel: fks.p1SelectionId, p2sel: fks.p2SelectionId,
        active: body.active === false ? 0 : 1,
        user: userName(req),
      },
    );
    // Markers 1-6 live in the T_GHProgenyMarkers child table, not on the
    // master row.  Persist them now that we have the inserted master ID.
    if (markerIds.length > 0) {
      await withTransaction(async (tx) => {
        await syncProgenyMarkers(tx, inserted!.id, markerIds, userName(req));
      });
    }
    await recalcSeedlingMaster();
    scheduleTrayPipeline();
    res.status(201).json({ id: inserted!.id });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── PUT /crosses/:id ─────────────────────────────────────────────────

router.put("/crosses/:id", requireBreeder, async (req, res) => {
  try {
    const body = UpdateCrossBody.parse(req.body);
    const id = parseInt(String(req.params.id));
    const dest1Id = await resolveLocationId(body.destination1);
    const dest2Id = await resolveLocationId(body.destination2);
    const lab1Id = await resolveLabId(body.testingLab1);
    const lab2Id = await resolveLabId(body.testingLab2);
    const traySize = await resolveTraySizeFromId(body.traySize);
    const fks = await resolveCrossFks({
      berryId: body.berryId, teamId: body.teamId,
      d1ProgramId: body.d1ProgramId, destination1Id: dest1Id,
      pollinationYear: body.pollinationYear,
      parent1: body.parent1, parent2: body.parent2,
    });
    const markerIds = await resolveMarkerIds(
      [body.marker1, body.marker2, body.marker3, body.marker4, body.marker5, body.marker6],
      body.berryId,
    );
    await execute(
      `UPDATE dbo.M_GHSeedlingMaster SET
          PROGENY = @progeny, PARENT1 = @parent1, PARENT2 = @parent2,
          BULK_PARENT3 = @bulk3, CROSS_DESIGNED_BY = @designedBy,
          Berry_ID = @berryId, Team_ID = @teamId, Pollination_Year = @py,
          DESTINATION1 = @dest1Name, DESTINATION1_FK = @dest1,
          DESTINATION2 = @dest2Name, DESTINATION2_FK = @dest2,
          D1_PROGRAM_FK = @d1prog, D2_PROGRAM_FK = @d2prog,
          D1_SEEDLING_SHIP_REQUEST = @d1ship, D2_SEEDLING_SHIP_REQUEST = @d2ship,
          Breeder_Requested_ShipDest1_Adjustments = @d1adj,
          Breeder_Requested_ShipDest2_Adjustments = @d2adj,
          D1_FIELD_PLANT_DATE = @d1Date, D2_FIELD_PLANT_DATE = @d2Date,
          -- REQUESTED_FIELD_PLANT_YEAR intentionally not patched — calculated server-side.
          EXPECTED_DISCARD_PERCENTAGE = @expDiscard,
          SPINELESS_DISCARD_PERCENTAGE = @spineless,
          TRANSPLANT_INSTRUCTIONS = @transInstr, TRAY_SIZE = @tray,
          SCREENING = @screening, SORT_BY_MARKER_GROUP = @sortMk,
          Testing_Lab_1_FK = @lab1, Testing_Lab_2_FK = @lab2,
          Total_Markers = @totalMk,
          SP_Crosses = @sp, RECIPROCAL_ALLOWED = @recip,
          SOW_SEED = @sow, Fumigated = @fum,
          BREEDER_COMMENTS = @brcm, GH_TEAM_COMMENTS = @ghcm,
          GHRatios_FK = @ratiosFk, Deadlines_FK = @deadlinesFk,
          P1_Selection_ID = @p1sel, P2_Selection_ID = @p2sel,
          ACTIVE = @active,
          Modified_By = @user, Modified_Date = GETDATE()
        WHERE GHSeedlingMaster_ID = @id`,
      {
        id,
        progeny: body.progeny ?? null,
        parent1: body.parent1 ?? null, parent2: body.parent2 ?? null,
        bulk3: body.bulkParent3 ?? null,
        designedBy: body.crossDesignedBy ?? null,
        berryId: body.berryId ?? null, teamId: body.teamId ?? null,
        py: body.pollinationYear ?? null,
        dest1Name: body.destination1 ?? null, dest1: dest1Id,
        dest2Name: body.destination2 ?? null, dest2: dest2Id,
        d1prog: body.d1ProgramId ?? null, d2prog: body.d2ProgramId ?? null,
        d1ship: body.d1SeedlingShipRequest ?? null, d2ship: body.d2SeedlingShipRequest ?? null,
        d1adj: body.breederRequestedShipDest1Adjustments ?? null,
        d2adj: body.breederRequestedShipDest2Adjustments ?? null,
        d1Date: body.d1FieldPlantDate ? new Date(body.d1FieldPlantDate) : null,
        d2Date: body.d2FieldPlantDate ? new Date(body.d2FieldPlantDate) : null,
        // REQUESTED_FIELD_PLANT_YEAR intentionally omitted — calculated server-side.
        expDiscard: body.expectedDiscardPercentage ?? null,
        spineless: body.spinelessDiscardPercentage ?? null,
        transInstr: body.transplantInstructions ?? null,
        // TRAY_SIZE column holds the actual size value (e.g. 38, 50), not the
        // Tray_Size_ID the form sends.  resolveTraySizeFromId maps it.
        tray: traySize ?? null,
        screening: toBit(body.screening),
        sortMk: toBit(body.sortByMarkerGroup),
        lab1: lab1Id, lab2: lab2Id,
        // Total_Markers reflects the resolved marker count so it stays in
        // sync with T_GHProgenyMarkers (replaced in the syncProgenyMarkers
        // call below).
        totalMk: markerIds.length,
        sp: toBit(body.spCrosses),
        recip: toBit(body.reciprocalAllowed),
        sow: toBit(body.sowSeed, true),
        fum: toBit(body.fumigated),
        brcm: body.breederComments ?? null,
        ghcm: body.ghTeamComments ?? null,
        ratiosFk: fks.ghRatiosId, deadlinesFk: fks.deadlinesId,
        p1sel: fks.p1SelectionId, p2sel: fks.p2SelectionId,
        active: body.active === false ? 0 : 1,
        user: userName(req),
      },
    );
    // Re-sync the marker child rows after the master update.  Always runs
    // (even with zero markers) so removing all markers via the form actually
    // empties T_GHProgenyMarkers for this row.
    await withTransaction(async (tx) => {
      await syncProgenyMarkers(tx, id, markerIds, userName(req));
    });
    await recalcSeedlingMaster();
    scheduleTrayPipeline();
    res.json({ id });
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// ── DELETE /crosses/:id (soft) ───────────────────────────────────────

router.delete("/crosses/:id", requireBreederOnly, async (req, res) => {
  try {
    await execute(
      `UPDATE dbo.M_GHSeedlingMaster
          SET ACTIVE = 0, Modified_Date = GETDATE(), Modified_By = @user
        WHERE GHSeedlingMaster_ID = @id`,
      { id: parseInt(String(req.params.id)), user: userName(req) },
    );
    scheduleTrayPipeline();
    res.status(204).send();
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

// NOTE: POST /crosses/upload (Excel import) is intentionally not implemented
// here — the Flask upload app (embedded in the Upload Data page via iframe)
// handles the full three-sheet pipeline (parents, crosses, markers) with the
// battle-tested stored proc validation.

export default router;
