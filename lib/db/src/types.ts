/**
 * TypeScript row-shape interfaces for SQL Server tables and views in the
 * `GHSeed` database (and a few shared lookups in `TPN`).
 *
 * Column names match the actual SQL Server schema (snake_case / PascalCase),
 * *not* camelCase.  Queries address columns by their real names so SQL stays
 * copy-pasteable into SSMS.
 *
 * Nullability matches the DB:  NULL in the schema → `| null` here.
 * `bit` columns are surfaced as `boolean` where the app always treats them
 * as booleans; as `0 | 1` where the app mixes numeric checks.
 */

// ── Base / reference tables ───────────────────────────────────────────────

// TPN.dbo.M_BerryID
export interface BerryRow {
  PK_BerryID: number;
  BerryType: string;
  BerryCode: string;
  CreatedBy: string;
  CreatedDateTime: Date;
  ModifiedBy: string;
  ModifiedDateTime: Date;
}

// TPN.dbo.M_Locations
export interface LocationRow {
  Location_ID: number;
  LocationName: string;
  LocationCode: string;
  Created_By: string;
  Created_Datetime: Date;
  Modified_By: string | null;
  Modified_Datetime: Date | null;
  Active: boolean;
}

// TPN.dbo.M_SrcBreedingProgram
export interface ProgramRow {
  SrcBreedingProgramId: number;
  BerryType: number | null;
  SrcBreedingProgram: string;
  Active: number; // tinyint
  CreatedBy: string;
  CreatedDateTime: Date;
  ModifiedBy: string;
  ModifiedDateTime: Date;
}

// GHSeed.dbo.M_GHTeams
export interface TeamRow {
  Team_ID: number;
  Team_Name: string | null;
  Created_By: string | null;
  Created_Date: Date | null;
  Modified_By: string | null;
  Modified_Date: Date | null;
  Active: boolean | null;
}

// GHSeed.dbo.M_GHLabs
export interface LabRow {
  GHLab_ID: number;
  Lab_Name: string | null;
  CreatedBy: string | null;
  CreatedDateTime: Date | null;
  ModifiedBy: string | null;
  ModifiedDateTime: Date | null;
  Plate_Sample_Num: number | null;
  Active: boolean | null;
}

// GHSeed.dbo.M_GHTraySize
export interface TraySizeRow {
  Tray_Size_ID: number;
  Tray_Size: number | null;
  M2_Per_Tray: number | null;
  Created_By: string | null;
  Created_DateTime: Date | null;
  Modified_By: string | null;
  Modified_DateTime: Date | null;
  Active: boolean | null;
}

// GHSeed.dbo.M_GHRatios
export interface RatioRow {
  GHRatios_ID: number;
  Female_Flowers_Per_Male_Flower: number | null;
  Pollination_Success_Percentage: number | null;
  Pollination_Std_Dev: number | null;
  Grams_Seed_Per_Fruit: number | null;
  Grams_Seed_Per_Fruit_Std_Dev: number | null;
  Seeds_Per_Gram_Of_Seed: number | null;
  Seed_Num_Per_Gram_Std_Dev: number | null;
  Avg_Seed_Germination_Percentage: number | null;
  Seed_Germination_Std_Dev: number | null;
  Seedling_Transplant_Success_Percentage: number | null;
  Buffer_Percent_Of_Std_Dev: number | null;
  Comments: string | null;
  Created_Date: Date | null;
  Created_By: string | null;
  Modified_Date: Date | null;
  Modified_By: string | null;
  Avg_Flowers_Per_Parent: number | null;
  Flowers_Per_Parent_Std_Dev: number | null;
  Seed_Sow_Buffer_Grams: number | null;
  Active: boolean | null;
  Germ_calc: number | null;
  Seed_Gram_calc: number | null;
  Grams_Seed_Per_Fruit_calc: number | null;
  Flowers_per_Parent_Calc: number | null;
  Berry_ID: number | null;
  Program_ID: number | null;
  Team_ID: number | null;
  Pollination_Success_Calc: number | null;
  Seed_Weight_Shipping_Calc: number | null;
}

// GHSeed.dbo.M_GHDeadlines
export interface DeadlineRow {
  Deadlines_ID: number;
  Crossing_File_Deadline: number | null;
  Pollination_Start: number | null;
  Pollination_Deadline: number | null;
  Fruit_Collect_Start: number | null;
  Fruit_Collect_Deadline: number | null;
  Seed_Acid_Start: number | null;
  Seed_Acid_Deadline: number | null;
  Seed_Sow_Start: number | null;
  Seed_Sow_Deadline: number | null;
  Transplant_Start: number | null;
  Transplant_Deadline: number | null;
  Marker_Screen_Start: number | null;
  Marker_Screening_Deadline: number | null;
  Marker_Results_Deadline: number | null;
  Comments: string | null;
  Berry_ID: number | null;
  Team_ID: number | null;
  Destination_ID: number | null;
  Program_ID: number | null;
  Created_DateTime: Date | null;
  Created_By: string | null;
  Modified_DateTime: Date | null;
  Modified_By: string | null;
  Active: boolean | null;
}

// GHSeed.dbo.M_GHTransplant_Instructions
export interface TransplantInstructionRow {
  TransplantInstructionID: number;
  Instructions: string;
  CreatedBy: string;
  CreatedDateTime: Date;
  ModifiedBy: string | null;
  ModifiedDateTime: Date | null;
  Active: boolean;
}

// GHSeed.dbo.M_GHGenotypeScreen
export interface GenotypeScreenRow {
  GHGenotypeScreen_ID: number;
  Genotyping_Screen: string | null;
  Created_By: string | null;
  Created_DateTime: Date | null;
  Modified_By: string | null;
  Modified_DateTime: Date | null;
}

// GHSeed.dbo.M_GHLabPrice
export interface LabPriceRow {
  GHLabPrice_ID: number;
  Berry_ID: number | null;
  Genotype_Screen_ID: number | null;
  GHLab_ID: number | null;
  Sample_Price: number | null;
  Year: number | null;
  Created_By: string | null;
  Created_DateTime: Date | null;
  Modified_By: string | null;
  Modified_DateTime: Date | null;
}

// GHSeed.dbo.M_GHMarkerAllocation
export interface MarkerAllocationRow {
  M_GHMarkerAllocationID: number;
  Marker_Sample_Allocation_Total: number | null;
  Marker_Cost_Allocation_Total: number | null;
  Pollination_Year: number | null;
  Berry_ID: number | null;
  Program_ID: number | null;
  GHLab_ID: number | null;
  GHTeam_ID: number | null;
}

// GHSeed.dbo.M_GHMarkerLabs
export interface MarkerLabsRow {
  GHMarkerLabs_ID: number;
  Berry_ID: number | null;
  Preferred_Lab_ID: number | null;
  Trait_Marker: string | null;
  Marker_Alias_Driscolls: string | null;
  Marker_Alias_Corteva: string | null;
  Corteva_Lab_Status: string | null;
  LGC_Lab_Status: string | null;
  Created_By: string | null;
  Created_DateTime: Date | null;
  Modified_By: string | null;
  Modified_DateTime: Date | null;
  Active: boolean | null;
}

// GHSeed.dbo.M_GHUserLevel
export interface UserLevelRow {
  UserLevel_ID: number;
  UserLevel: string;
  Active: boolean;
  Created_By: string;
  Created_DateTime: Date;
  Modified_By: string;
  Modified_DateTime: Date;
}

// ── Core tables (T_ prefix) ────────────────────────────────────────────────

// GHSeed.dbo.T_GHEmployees
export interface EmployeeRow {
  GHEmployee_ID: number;
  GH_Employee: string | null;
  Employee_Num: number | null;
  Created_DateTime: Date | null;
  Created_By: string | null;
  Modified_DateTime: Date | null;
  Modified_By: string | null;
  Team_ID: number | null;
  Active: boolean | null;
  UserLevel_FK: number | null;
  Email: string | null;
}

// GHSeed.dbo.T_GHParentInventory2
export interface ParentInventoryRow {
  GHParentInventory_ID: number;
  Selection: string | null;
  L1FC: string | null;
  L1: string | null;
  L2FC: string | null;
  L2: string | null;
  L3FC: string | null;
  L3: string | null;
  L4FC: string | null;
  L4: string | null;
  Total_Parents: number | null;
  FLOWERS_REQUIRED_FOR_POLLEN: number | null;
  TOTAL_FLOWERS_COLLECTED: number | null;
  FLOWERS_FOR_POLLEN_USED: number | null;
  BAD_POLLEN: number | null;
  FLOWERS_FOR_POLLEN_AVAIL: number | null;
  FLOWERS_FOR_POLLEN_VARIANCE: number | null;
  Pollination_Year: number | null;
  Comments: string | null;
  CreatedDateTime: Date | null;
  CreatedBy: string | null;
  ModifiedDateTime: Date | null;
  ModifiedBy: string | null;
  Active: boolean | null;
  Berry_ID: number | null;
  Team_ID: number | null;
  SP_Crosses: boolean | null;
  First_Yr_Parent: number | null;
}

// GHSeed.dbo.T_GHLifecycleStatus
export interface LifecycleStatusRow {
  LifecycleStatus_ID: number;
  Berry_ID: string;
  Team_ID: number;
  Pollination_Year: number | null;
  Pollen_Done: boolean | null;
  Pollination_Done: boolean | null;
  Fruit_Done: boolean | null;
  Seed_Done: boolean | null;
  Transplant_Done: boolean | null;
  Screen_Done: boolean | null;
  Ship_Done: boolean | null;
  Modified_By: string | null;
  Modified_DateTime: Date;
}

// GHSeed.dbo.T_GHTraysCreation
export interface TrayCreationRow {
  Tray_Creation_ID: number;
  Unique_Tray_Code: string | null;
  Plate_Barcode: string | null;
  Plant_Qty: number | null;
  ghsm_FK: number | null;
  Test_Lab_ID: number | null;
  Created_By: string | null;
  Created_DateTime: Date | null;
  Modified_By: string | null;
  Modified_DateTime: Date | null;
  Pollination_Year: number | null;
  Plate_Index: number | null;
  Berry_ID: number | null;
}

// GHSeed.dbo.M_GHSeedlingMaster — the big one.  Covers every column returned
// from vw_GH_CrossesDesk for list/update; the view has additional computed
// columns layered on top (see CrossesViewRow below).
export interface SeedlingMasterRow {
  GHSeedlingMaster_ID: number;
  PROGENY: string | null;
  PARENT1: string | null;
  PARENT2: string | null;
  BULK_PARENT3: string | null;
  RECIPROCAL_ALLOWED: boolean | null;
  FLOWERS_TO_POLLINATE_REQUIRED: number | null;
  FLOWERS_REQUIRED_FOR_POLLEN: number | null;
  FRUIT_REQUIRED: number | null;
  SEED_WEIGHT_REQUIRED: number | null;
  DESTINATION1: string | null;
  DESTINATION2: string | null;
  D1_SEEDLING_SHIP_REQUEST: number | null;
  D2_SEEDLING_SHIP_REQUEST: number | null;
  TRANSPLANT_INSTRUCTIONS: string | null;
  TRAY_SIZE: number | null;
  TRANSPLANTS_REQUIRED: number | null;
  Breeder_Adjustment_Date: Date | null;
  SCREENING: boolean | null;
  SORT_BY_MARKER_GROUP: boolean | null;
  EXPECTED_DISCARD_PERCENTAGE: number | null;
  Total_Markers: string | null;
  BREEDER_COMMENTS: string | null;
  GH_TEAM_COMMENTS: string | null;
  Created_Date: Date | null;
  Created_By: string | null;
  Modified_Date: Date | null;
  Modified_By: string | null;
  Breeder_Requested_ShipDest1_Adjustments: number | null;
  Breeder_Requested_ShipDest2_Adjustments: number | null;
  P1_TOTAL_PARENTS_REQUIRED: number | null;
  P2_TOTAL_PARENTS_REQUIRED: number | null;
  Pollination_Year: number | null;
  CROSS_DESIGNED_BY: string | null;
  GHRatios_FK: number | null;
  SPINELESS_DISCARD_PERCENTAGE: number | null;
  SOW_SEED: boolean | null;
  RECIPROCAL_DONE: boolean | null;
  Trays_Requested_Calc: number | null;
  ACTIVE: boolean | null;
  GHLabsTrays_FK: number | null;
  Berry_ID: number | null;
  Team_ID: number | null;
  P1_Selection_ID: number | null;
  P2_Selection_ID: number | null;
  DESTINATION1_FK: number | null;
  DESTINATION2_FK: number | null;
  Testing_Lab_1_FK: number | null;
  Testing_Lab_2_FK: number | null;
  D1_PROGRAM_FK: number | null;
  D2_PROGRAM_FK: number | null;
  Deadlines_FK: number | null;
  D1_FIELD_PLANT_DATE: Date | null;
  D2_FIELD_PLANT_DATE: Date | null;
  REQUESTED_FIELD_PLANT_YEAR: number | null;
  Pollen_Parent: string | null;
  Fumigated: boolean | null;
  SP_Crosses: boolean | null;
  Recalculation_Date: Date | null;
  D1_Transplant_Adjustment: number | null;
  D2_Transplant_Adjustment: number | null;
  TOTAL_SEEDLING_SHIP_REQUEST_Calc: number | null;
}

// ── Views (read-only shapes used by list/detail endpoints) ─────────────────

/**
 * Generic view row — use `Record<string, unknown>` cast + explicit interfaces
 * per endpoint as the routes are migrated.  We start with the top-level crosses
 * desk view since it's the largest and drives the main list pages.
 */

// Partial type for vw_GH_CrossesDesk — extend as route migrations need more columns.
export type CrossesDeskRow = Record<string, unknown>;

// Partial type for vw_GHPollenDesk
export type PollenDeskRow = Record<string, unknown>;

// Partial type for vw_GH_PollinationDesk
export type PollinationDeskRow = Record<string, unknown>;

// Partial type for vw_GH_FruitDesk
export type FruitDeskRow = Record<string, unknown>;

// Partial type for vw_GHSeedDesk
export type SeedDeskRow = Record<string, unknown>;

// Partial type for vw_GH_TransplantDesk
export type TransplantDeskRow = Record<string, unknown>;

// Partial type for vw_GH_MarkerPlateDesk
export type MarkerPlateDeskRow = Record<string, unknown>;

// Partial type for vw_GH_MarkerProgenyDesk
export type MarkerProgenyDeskRow = Record<string, unknown>;

// Partial type for vw_GH_Destination_Shipping
export type ShippingRow = Record<string, unknown>;

// Partial type for vw_GH_Sufficient_Parents
export type SufficientParentsRow = Record<string, unknown>;
