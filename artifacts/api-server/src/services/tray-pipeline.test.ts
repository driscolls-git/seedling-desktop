import { describe, it, expect, vi } from "vitest";

// tray-pipeline.ts imports the DB layer at module load. These tests only
// exercise the pure logic / orchestration with fakes, so stub the DB module to
// keep them hermetic (no mssql import, no connection attempt).
vi.mock("@workspace/db", () => ({
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
  sql: { Int: () => ({}) },
}));

import { _internals, runTrayPipeline, previewTrayPipeline } from "./tray-pipeline";
import type {
  PreTray,
  SourceRow,
  ExistingTray,
  InsertTray,
  TrayPlan,
  TrayRepository,
} from "./tray-pipeline";

const { buildTraysForSource, planChanges } = _internals;

type Src = Parameters<typeof buildTraysForSource>[0];

// Defaults model the common case: a 96-well plate split into 38-plant trays
// (→ 3 trays per plate), screened. Override per test.
function makeSource(overrides: Partial<Src> = {}): Src {
  return {
    ghSeedlingMasterId: 111,
    progeny: "1234",
    berryId: 1,
    berryCode: "BK",
    traySize: 38,
    transplantsRequired: 96,
    pollinationYear: 2026,
    testLabId: 7,
    plateSampleNum: 96,
    screening: true,
    ...overrides,
  };
}

function makePreTray(overrides: Partial<PreTray> = {}): PreTray {
  return {
    uniqueTrayCode: "BK1.01",
    plantQty: 38,
    ghsmFk: 10,
    testLabId: 7,
    pollinationYear: 2026,
    berryId: 1,
    plateWithinProgeny: 1,
    screening: true,
    ...overrides,
  };
}

function makeExisting(overrides: Partial<ExistingTray> = {}): ExistingTray {
  return {
    uniqueTrayCode: "BK1.01",
    ghsmFk: 10,
    plantQty: 38,
    plateIndex: 1,
    berryId: 1,
    pollinationYear: 2026,
    ...overrides,
  };
}

const shape = (trays: readonly PreTray[]) =>
  trays.map((t) => [t.uniqueTrayCode, t.plantQty, t.plateWithinProgeny]);
const idxByCode = (rows: readonly InsertTray[]) =>
  Object.fromEntries(rows.map((r) => [r.uniqueTrayCode, r.plateIndex]));

describe("buildTraysForSource — tray-code math (characterization)", () => {
  it("fills exactly one 96-well plate into 3 trays (38 / 38 / 20)", () => {
    const trays = buildTraysForSource(makeSource({ transplantsRequired: 96 }));
    expect(shape(trays)).toEqual([
      ["BK1234.01", 38, 1],
      ["BK1234.02", 38, 1],
      ["BK1234.03", 20, 1],
    ]);
  });

  it("spills into a second plate when the plate is exceeded (100 plants)", () => {
    const trays = buildTraysForSource(makeSource({ transplantsRequired: 100 }));
    expect(shape(trays)).toEqual([
      ["BK1234.01", 38, 1],
      ["BK1234.02", 38, 1],
      ["BK1234.03", 20, 1],
      ["BK1234.04", 4, 2],
    ]);
  });

  it("produces a single partial tray when plants fit in one tray (38)", () => {
    expect(shape(buildTraysForSource(makeSource({ transplantsRequired: 38 })))).toEqual([
      ["BK1234.01", 38, 1],
    ]);
  });

  it("handles a single plant (1)", () => {
    expect(shape(buildTraysForSource(makeSource({ transplantsRequired: 1 })))).toEqual([
      ["BK1234.01", 1, 1],
    ]);
  });

  it("respects an alternate tray size (50 → 2 trays per 96-well plate)", () => {
    expect(
      shape(buildTraysForSource(makeSource({ traySize: 50, transplantsRequired: 96 }))),
    ).toEqual([
      ["BK1234.01", 50, 1],
      ["BK1234.02", 46, 1],
    ]);
  });

  it("zero-pads the suffix to two digits and continues past 9 (289 plants → .01…​.10)", () => {
    const trays = buildTraysForSource(makeSource({ transplantsRequired: 289 }));
    expect(trays).toHaveLength(10);
    expect(trays[0].uniqueTrayCode).toBe("BK1234.01");
    expect(trays[8].uniqueTrayCode).toBe("BK1234.09");
    expect(trays[9].uniqueTrayCode).toBe("BK1234.10");
    expect(trays[9].plantQty).toBe(1);
    expect(trays[9].plateWithinProgeny).toBe(4);
  });

  it("returns no trays for non-positive inputs (guards)", () => {
    expect(buildTraysForSource(makeSource({ transplantsRequired: 0 }))).toEqual([]);
    expect(buildTraysForSource(makeSource({ transplantsRequired: -5 }))).toEqual([]);
    expect(buildTraysForSource(makeSource({ traySize: 0 }))).toEqual([]);
    expect(buildTraysForSource(makeSource({ plateSampleNum: 0 }))).toEqual([]);
  });

  it("carries the screening flag onto every tray", () => {
    expect(buildTraysForSource(makeSource({ screening: false }))[0].screening).toBe(false);
    expect(buildTraysForSource(makeSource({ screening: true }))[0].screening).toBe(true);
  });

  it("conserves total plant count across the generated trays", () => {
    for (const total of [1, 37, 38, 39, 96, 97, 100, 289, 500]) {
      const sum = buildTraysForSource(makeSource({ transplantsRequired: total })).reduce(
        (n, t) => n + t.plantQty,
        0,
      );
      expect(sum, `total=${total}`).toBe(total);
    }
  });
});

describe("planChanges — additive diff (insert / top-up / back-fill)", () => {
  it("inserts a new screened tray with a Plate_Index from MAX+1 (empty table → 1)", () => {
    const plan = planChanges([makePreTray({ uniqueTrayCode: "BK1.01", screening: true })], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].plateIndex).toBe(1);
    expect(plan.qtyUpdates).toEqual([]);
    expect(plan.plateBackfills).toEqual([]);
  });

  it("inserts a new NON-screened tray with a NULL Plate_Index", () => {
    const plan = planChanges([makePreTray({ uniqueTrayCode: "BK1.01", screening: false })], []);
    expect(plan.inserts[0].plateIndex).toBeNull();
  });

  it("inserts a non-screened tray with no lab (NULL Test_Lab_ID and NULL Plate_Index)", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", screening: false, testLabId: null })],
      [],
    );
    expect(plan.inserts[0]).toMatchObject({ plateIndex: null, testLabId: null });
  });

  it("continues Plate_Index from the existing MAX for that berry+year", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK2.01", ghsmFk: 20, screening: true })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plateIndex: 5 })],
    );
    expect(plan.inserts[0].plateIndex).toBe(6);
  });

  it("tops up Plant_Qty when a tray grew (and does nothing else)", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 22 })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 12, plateIndex: 3 })],
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.qtyUpdates).toEqual([{ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 22 }]);
    expect(plan.plateBackfills).toEqual([]);
  });

  it("makes no changes when the tray is unchanged", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38 })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, plateIndex: 1 })],
    );
    expect(plan).toEqual({ inserts: [], qtyUpdates: [], plateBackfills: [] });
  });

  it("never shrinks Plant_Qty when the count dropped (decision B: leave as-is)", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 20 })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, plateIndex: 1 })],
    );
    expect(plan.qtyUpdates).toEqual([]);
  });

  it("back-fills a NULL Plate_Index when a progeny is now screened", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, screening: true })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, plateIndex: null })],
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.qtyUpdates).toEqual([]);
    expect(plan.plateBackfills).toEqual([{ uniqueTrayCode: "BK1.01", ghsmFk: 10, plateIndex: 1 }]);
  });

  it("never overwrites an existing non-null Plate_Index", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, screening: true })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plateIndex: 9 })],
    );
    expect(plan.plateBackfills).toEqual([]);
  });

  it("does not back-fill a NULL index for a non-screened progeny", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, screening: false })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plateIndex: null })],
    );
    expect(plan.plateBackfills).toEqual([]);
  });

  it("gives a new tray on an existing plate that plate's existing Plate_Index", () => {
    // Plate 1 of progeny 10 already exists (index 4); a new .02 lands on it.
    const plan = planChanges(
      [
        makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plateWithinProgeny: 1, plantQty: 38 }),
        makePreTray({ uniqueTrayCode: "BK1.02", ghsmFk: 10, plateWithinProgeny: 1, plantQty: 10 }),
      ],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plateIndex: 4, plantQty: 38 })],
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ uniqueTrayCode: "BK1.02", plateIndex: 4 });
  });

  it("numbers new plates from MAX+1, ordered by ghsmFk then plate", () => {
    const plan = planChanges(
      [
        makePreTray({ uniqueTrayCode: "BK9.01", ghsmFk: 90, plateWithinProgeny: 1, screening: true }),
        makePreTray({ uniqueTrayCode: "BK5.01", ghsmFk: 50, plateWithinProgeny: 1, screening: true }),
      ],
      [makeExisting({ uniqueTrayCode: "Xold", ghsmFk: 1, plateIndex: 2 })],
    );
    // MAX=2; ghsm 50 sorts first → 3, ghsm 90 → 4.
    expect(idxByCode(plan.inserts)).toEqual({ "BK5.01": 3, "BK9.01": 4 });
  });

  it("indexes each (berry, year) group independently", () => {
    const plan = planChanges(
      [
        makePreTray({ uniqueTrayCode: "BK1.01", berryId: 1, pollinationYear: 2026, ghsmFk: 10 }),
        makePreTray({ uniqueTrayCode: "BU1.01", berryId: 2, pollinationYear: 2026, ghsmFk: 30 }),
        makePreTray({ uniqueTrayCode: "BK1n.01", berryId: 1, pollinationYear: 2027, ghsmFk: 40 }),
      ],
      [makeExisting({ uniqueTrayCode: "Xold", ghsmFk: 1, berryId: 1, pollinationYear: 2026, plateIndex: 3 })],
    );
    expect(idxByCode(plan.inserts)).toEqual({ "BK1.01": 4, "BU1.01": 1, "BK1n.01": 1 });
  });

  it("combines top-up, back-fill and a new plate in one run", () => {
    // Progeny 10, plate 1: .01 exists (index 5, qty 38) and .02 exists (null idx, qty 12);
    // now screened, qty grew so .02 → 20 and a new plate .03 (plate 2) appears.
    const plan = planChanges(
      [
        makePreTray({ uniqueTrayCode: "P.01", ghsmFk: 10, plateWithinProgeny: 1, plantQty: 38, screening: true }),
        makePreTray({ uniqueTrayCode: "P.02", ghsmFk: 10, plateWithinProgeny: 1, plantQty: 20, screening: true }),
        makePreTray({ uniqueTrayCode: "P.03", ghsmFk: 10, plateWithinProgeny: 2, plantQty: 5, screening: true }),
      ],
      [
        makeExisting({ uniqueTrayCode: "P.01", ghsmFk: 10, plateIndex: 5, plantQty: 38 }),
        makeExisting({ uniqueTrayCode: "P.02", ghsmFk: 10, plateIndex: null, plantQty: 12 }),
      ],
    );
    // .02 tops up 12 → 20; plate 1 already has index 5, so .02's null back-fills to 5.
    expect(plan.qtyUpdates).toEqual([{ uniqueTrayCode: "P.02", ghsmFk: 10, plantQty: 20 }]);
    expect(plan.plateBackfills).toEqual([{ uniqueTrayCode: "P.02", ghsmFk: 10, plateIndex: 5 }]);
    // New plate 2 (.03) continues from MAX(5) → 6.
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ uniqueTrayCode: "P.03", plateIndex: 6 });
  });

  it("never emits a delete — the plan only has inserts / updates / back-fills", () => {
    const plan = planChanges([makePreTray()], []);
    expect(Object.keys(plan).sort()).toEqual(["inserts", "plateBackfills", "qtyUpdates"]);
  });
});

// A fake repository that records what the orchestrator asks of it and runs the
// pure `plan` against in-memory state — no database.
class FakeTrayRepository implements TrayRepository {
  sources: SourceRow[] = [];
  existing: ExistingTray[] = [];
  applyCalls = 0;
  lastPlan: TrayPlan | null = null;

  async fetchSourceRows(): Promise<SourceRow[]> {
    return this.sources;
  }

  async fetchExisting(): Promise<ExistingTray[]> {
    return this.existing;
  }

  async apply(args: {
    currentYear: number;
    nextYear: number;
    createdBy: string;
    plan: (reads: { existing: ExistingTray[] }) => TrayPlan;
  }): Promise<TrayPlan> {
    this.applyCalls++;
    const plan = args.plan({ existing: this.existing });
    this.lastPlan = plan;
    return plan;
  }
}

describe("runTrayPipeline — orchestration (fake repository)", () => {
  it("builds trays and plans inserts for a screened cross", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [makeSource({ transplantsRequired: 96, ghSeedlingMasterId: 10, progeny: "1" })];
    await runTrayPipeline(repo);
    expect(repo.applyCalls).toBe(1);
    expect(idxByCode(repo.lastPlan!.inserts)).toEqual({ "BK1.01": 1, "BK1.02": 1, "BK1.03": 1 });
  });

  it("plans NULL plate indexes for a non-screened cross", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [
      makeSource({ transplantsRequired: 38, ghSeedlingMasterId: 10, progeny: "1", screening: false }),
    ];
    await runTrayPipeline(repo);
    expect(repo.lastPlan!.inserts.map((t) => t.plateIndex)).toEqual([null]);
  });

  it("never opens the transaction when there are no source crosses", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [];
    await runTrayPipeline(repo);
    expect(repo.applyCalls).toBe(0);
  });

  it("plans no changes when everything already exists unchanged", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [makeSource({ transplantsRequired: 38, ghSeedlingMasterId: 10, progeny: "1" })];
    repo.existing = [
      { uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, plateIndex: 1, berryId: 1, pollinationYear: 2026 },
    ];
    await runTrayPipeline(repo);
    expect(repo.lastPlan).toEqual({ inserts: [], qtyUpdates: [], plateBackfills: [] });
  });
});

describe("previewTrayPipeline — read-only plan", () => {
  it("returns the plan without ever applying it", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [makeSource({ transplantsRequired: 96, ghSeedlingMasterId: 10, progeny: "1" })];
    const result = await previewTrayPipeline(repo);
    expect(repo.applyCalls).toBe(0); // never writes
    expect(result.sources).toBe(1);
    expect(result.computedTrays).toBe(3);
    expect(result.plan.inserts).toHaveLength(3);
    expect(result.plan.qtyUpdates).toEqual([]);
    expect(result.plan.plateBackfills).toEqual([]);
  });
});
