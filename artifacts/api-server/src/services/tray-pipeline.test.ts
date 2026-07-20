import { describe, it, expect, vi } from "vitest";

// tray-pipeline.ts imports the DB layer at module load. These tests only
// exercise the pure logic / orchestration with fakes, so stub the DB module to
// keep them hermetic (no mssql import, no connection attempt).
vi.mock("@workspace/db", () => ({
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
  callProc: vi.fn(),
  sql: { Int: () => ({}) },
}));

import { _internals, generateTrayCodesForSelection, previewTrayPipeline } from "./tray-pipeline";
import type {
  PreTray,
  SourceRow,
  ExistingTray,
  InsertTray,
  TrayPlan,
  TrayRepository,
} from "./tray-pipeline";

const { buildTraysForSource, classifySources, planChanges } = _internals;

type Src = Parameters<typeof buildTraysForSource>[0];

const NOW = new Date("2026-07-20T00:00:00Z");
const PASSED = new Date("2026-01-01T00:00:00Z"); // deadline in the past
const FUTURE = new Date("2027-01-01T00:00:00Z"); // deadline not yet reached

// Defaults model the common case: a 96-well plate split into 38-plant trays
// (→ 3 trays per plate), screened, deadline passed with seed collected.
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
    acidDeadlineDate: PASSED,
    seedWeightInventory: 100,
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
    progeny: "1234",
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
const codeQty = (trays: readonly PreTray[]) =>
  trays.map((t) => [t.uniqueTrayCode, t.plantQty]);
const idxByCode = (rows: readonly InsertTray[]) =>
  Object.fromEntries(rows.map((r) => [r.uniqueTrayCode, r.plateIndex]));

describe("buildTraysForSource — screened plate-capped math (characterization)", () => {
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

  it("respects an alternate tray size (50 → 2 trays per 96-well plate)", () => {
    expect(
      shape(buildTraysForSource(makeSource({ traySize: 50, transplantsRequired: 96 }))),
    ).toEqual([
      ["BK1234.01", 50, 1],
      ["BK1234.02", 46, 1],
    ]);
  });

  it("returns no trays for non-positive inputs (guards)", () => {
    expect(buildTraysForSource(makeSource({ transplantsRequired: 0 }))).toEqual([]);
    expect(buildTraysForSource(makeSource({ transplantsRequired: -5 }))).toEqual([]);
    expect(buildTraysForSource(makeSource({ traySize: 0 }))).toEqual([]);
    expect(buildTraysForSource(makeSource({ plateSampleNum: 0 }))).toEqual([]);
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

describe("buildTraysForSource — non-screened uncapped math", () => {
  it("is NOT capped by plate size: 200 / 38 → 6 trays (38×5 + 10)", () => {
    const trays = buildTraysForSource(
      makeSource({ screening: false, transplantsRequired: 200, traySize: 38 }),
    );
    expect(codeQty(trays)).toEqual([
      ["BK1234.01", 38],
      ["BK1234.02", 38],
      ["BK1234.03", 38],
      ["BK1234.04", 38],
      ["BK1234.05", 38],
      ["BK1234.06", 10],
    ]);
    // Every tray is non-screened (→ NULL plate index downstream).
    expect(trays.every((t) => t.screening === false)).toBe(true);
  });

  it("differs from the screened plate-capped result for the same inputs", () => {
    const nonScreened = buildTraysForSource(
      makeSource({ screening: false, transplantsRequired: 200, traySize: 38 }),
    );
    const screened = buildTraysForSource(
      makeSource({ screening: true, transplantsRequired: 200, traySize: 38 }),
    );
    expect(nonScreened).toHaveLength(6); // uncapped
    expect(screened).toHaveLength(7); // 96-well plate cap forces an extra tray
  });

  it("ignores plate size entirely (plateSampleNum has no effect)", () => {
    const a = buildTraysForSource(
      makeSource({ screening: false, transplantsRequired: 100, traySize: 38, plateSampleNum: 96 }),
    );
    const b = buildTraysForSource(
      makeSource({ screening: false, transplantsRequired: 100, traySize: 38, plateSampleNum: 384 }),
    );
    expect(codeQty(a)).toEqual(codeQty(b));
    expect(codeQty(a)).toEqual([
      ["BK1234.01", 38],
      ["BK1234.02", 38],
      ["BK1234.03", 24],
    ]);
  });

  it("zero-pads the suffix to two digits", () => {
    const trays = buildTraysForSource(
      makeSource({ screening: false, transplantsRequired: 380, traySize: 38 }),
    );
    expect(trays).toHaveLength(10);
    expect(trays[9].uniqueTrayCode).toBe("BK1234.10");
  });

  it("conserves total plant count", () => {
    for (const total of [1, 37, 38, 39, 100, 289, 500]) {
      const sum = buildTraysForSource(
        makeSource({ screening: false, transplantsRequired: total }),
      ).reduce((n, t) => n + t.plantQty, 0);
      expect(sum, `total=${total}`).toBe(total);
    }
  });
});

describe("classifySources — deadline + seed-weight gating", () => {
  it("builds when the deadline has passed and seed weight > 0", () => {
    const { toBuild, toCancel } = classifySources(
      [makeSource({ acidDeadlineDate: PASSED, seedWeightInventory: 12 })],
      NOW,
    );
    expect(toBuild).toHaveLength(1);
    expect(toCancel).toHaveLength(0);
  });

  it("cancels when the deadline has passed and seed weight = 0", () => {
    const { toBuild, toCancel } = classifySources(
      [makeSource({ acidDeadlineDate: PASSED, seedWeightInventory: 0 })],
      NOW,
    );
    expect(toBuild).toHaveLength(0);
    expect(toCancel).toHaveLength(1);
  });

  it("treats a null seed weight as zero (cancel)", () => {
    const { toBuild, toCancel } = classifySources(
      [makeSource({ acidDeadlineDate: PASSED, seedWeightInventory: null })],
      NOW,
    );
    expect(toBuild).toHaveLength(0);
    expect(toCancel).toHaveLength(1);
  });

  it("drops progenies whose deadline has NOT passed (neither build nor cancel)", () => {
    const { toBuild, toCancel } = classifySources(
      [
        makeSource({ acidDeadlineDate: FUTURE, seedWeightInventory: 12 }),
        makeSource({ acidDeadlineDate: FUTURE, seedWeightInventory: 0 }),
      ],
      NOW,
    );
    expect(toBuild).toHaveLength(0);
    expect(toCancel).toHaveLength(0);
  });

  it("drops progenies with a NULL deadline", () => {
    const { toBuild, toCancel } = classifySources(
      [makeSource({ acidDeadlineDate: null, seedWeightInventory: 12 })],
      NOW,
    );
    expect(toBuild).toHaveLength(0);
    expect(toCancel).toHaveLength(0);
  });

  it("accepts a string deadline (as the driver may return it)", () => {
    const { toBuild } = classifySources(
      [makeSource({ acidDeadlineDate: "2026-01-01T00:00:00Z", seedWeightInventory: 5 })],
      NOW,
    );
    expect(toBuild).toHaveLength(1);
  });
});

describe("planChanges — additive diff (insert / top-up / back-fill / ship-zero)", () => {
  it("inserts a new screened tray with a Plate_Index from MAX+1 (empty table → 1)", () => {
    const plan = planChanges([makePreTray({ uniqueTrayCode: "BK1.01", screening: true })], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].plateIndex).toBe(1);
    expect(plan.qtyUpdates).toEqual([]);
    expect(plan.plateBackfills).toEqual([]);
    expect(plan.shipZeros).toEqual([]);
  });

  it("inserts a new NON-screened tray with a NULL Plate_Index", () => {
    const plan = planChanges([makePreTray({ uniqueTrayCode: "BK1.01", screening: false })], []);
    expect(plan.inserts[0].plateIndex).toBeNull();
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

  it("shrinks Plant_Qty when the computed count dropped", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 20 })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, plateIndex: 1 })],
    );
    expect(plan.qtyUpdates).toEqual([{ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 20 }]);
  });

  it("zeroes an orphaned tray for a processed progeny (no longer computed)", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38 })],
      [
        makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, plateIndex: 1 }),
        makeExisting({ uniqueTrayCode: "BK1.02", ghsmFk: 10, plantQty: 45, plateIndex: 2 }),
      ],
      { syncGhsmFks: [10] },
    );
    // .01 unchanged; .02 no longer computed → Plant_Qty set to 0 (not NULL, not deleted).
    expect(plan.qtyUpdates).toEqual([{ uniqueTrayCode: "BK1.02", ghsmFk: 10, plantQty: 0 }]);
    expect(plan.inserts).toEqual([]);
  });

  it("does not zero orphaned trays for progenies not in the sync set", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38 })],
      [
        makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, plateIndex: 1 }),
        makeExisting({ uniqueTrayCode: "ZZ.01", ghsmFk: 99, plantQty: 45, plateIndex: 2 }),
      ],
      { syncGhsmFks: [10] },
    );
    expect(plan.qtyUpdates).toEqual([]);
  });

  it("does not re-zero an already-zero orphaned tray", () => {
    const plan = planChanges(
      [],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 0, plateIndex: 1 })],
      { syncGhsmFks: [10] },
    );
    expect(plan.qtyUpdates).toEqual([]);
  });

  it("back-fills a NULL Plate_Index when a progeny is now screened", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, screening: true })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, plateIndex: null })],
    );
    expect(plan.plateBackfills).toEqual([{ uniqueTrayCode: "BK1.01", ghsmFk: 10, plateIndex: 1 }]);
  });

  it("never overwrites an existing non-null Plate_Index", () => {
    const plan = planChanges(
      [makePreTray({ uniqueTrayCode: "BK1.01", ghsmFk: 10, screening: true })],
      [makeExisting({ uniqueTrayCode: "BK1.01", ghsmFk: 10, plateIndex: 9 })],
    );
    expect(plan.plateBackfills).toEqual([]);
  });

  it("allocates new plate indexes in ascending PROGENY order (not ghsmFk order)", () => {
    // Progeny "AAA" has the HIGHER ghsmFk; progeny "ZZZ" the lower. Sorting by
    // progeny must put AAA first even though its ghsmFk is larger.
    const plan = planChanges(
      [
        makePreTray({ uniqueTrayCode: "Z.01", progeny: "ZZZ", ghsmFk: 10, screening: true }),
        makePreTray({ uniqueTrayCode: "A.01", progeny: "AAA", ghsmFk: 90, screening: true }),
      ],
      [],
    );
    // AAA → 1, ZZZ → 2 (progeny ascending), regardless of ghsmFk.
    expect(idxByCode(plan.inserts)).toEqual({ "A.01": 1, "Z.01": 2 });
  });

  it("indexes each (berry, year) group independently", () => {
    const plan = planChanges(
      [
        makePreTray({ uniqueTrayCode: "BK1.01", berryId: 1, pollinationYear: 2026, ghsmFk: 10, progeny: "1" }),
        makePreTray({ uniqueTrayCode: "BU1.01", berryId: 2, pollinationYear: 2026, ghsmFk: 30, progeny: "2" }),
        makePreTray({ uniqueTrayCode: "BK1n.01", berryId: 1, pollinationYear: 2027, ghsmFk: 40, progeny: "3" }),
      ],
      [makeExisting({ uniqueTrayCode: "Xold", ghsmFk: 1, berryId: 1, pollinationYear: 2026, plateIndex: 3 })],
    );
    expect(idxByCode(plan.inserts)).toEqual({ "BK1.01": 4, "BU1.01": 1, "BK1n.01": 1 });
  });

  it("emits a shipZero per cancelled ghsmFk", () => {
    const plan = planChanges([], [], { cancelGhsmFks: [55, 66] });
    expect(plan.shipZeros).toEqual([{ ghsmFk: 55 }, { ghsmFk: 66 }]);
    expect(plan.inserts).toEqual([]);
  });

  it("only ever emits inserts / updates / back-fills / ship-zeros — never a delete", () => {
    const plan = planChanges([makePreTray()], []);
    expect(Object.keys(plan).sort()).toEqual(["inserts", "plateBackfills", "qtyUpdates", "shipZeros"]);
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
    berryId: number;
    pollinationYear: number;
    createdBy: string;
    plan: (reads: { existing: ExistingTray[] }) => TrayPlan;
  }): Promise<TrayPlan> {
    this.applyCalls++;
    const plan = args.plan({ existing: this.existing });
    this.lastPlan = plan;
    return plan;
  }
}

const SEL = { berryId: 1, teamId: 2, pollinationYear: 2026 };

describe("generateTrayCodesForSelection — orchestration (fake repository)", () => {
  it("builds trays and plans inserts for a screened, deadline-passed, seed-bearing cross", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [
      makeSource({ transplantsRequired: 96, ghSeedlingMasterId: 10, progeny: "1", seedWeightInventory: 50 }),
    ];
    const recalc = vi.fn(async () => {});
    const summary = await generateTrayCodesForSelection(SEL, repo, recalc, NOW);
    expect(repo.applyCalls).toBe(1);
    expect(idxByCode(repo.lastPlan!.inserts)).toEqual({ "BK1.01": 1, "BK1.02": 1, "BK1.03": 1 });
    expect(summary.inserts).toBe(3);
    expect(recalc).not.toHaveBeenCalled(); // nothing cancelled
  });

  it("plans NULL plate indexes for a non-screened cross and does not cap by plate size", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [
      makeSource({
        transplantsRequired: 200, traySize: 38, ghSeedlingMasterId: 10, progeny: "1",
        screening: false, seedWeightInventory: 5,
      }),
    ];
    const summary = await generateTrayCodesForSelection(SEL, repo, vi.fn(async () => {}), NOW);
    expect(summary.inserts).toBe(6); // uncapped
    expect(repo.lastPlan!.inserts.every((t) => t.plateIndex === null)).toBe(true);
  });

  it("cancels a zero-seed progeny (ship-zero) and runs recalc afterward", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [
      makeSource({ ghSeedlingMasterId: 77, progeny: "9", seedWeightInventory: 0 }),
    ];
    const recalc = vi.fn(async () => {});
    const summary = await generateTrayCodesForSelection(SEL, repo, recalc, NOW);
    expect(summary.inserts).toBe(0);
    expect(summary.cancelled).toBe(1);
    expect(repo.lastPlan!.shipZeros).toEqual([{ ghsmFk: 77 }]);
    expect(recalc).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a progeny whose deadline has not passed (no trays, no recalc)", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [
      makeSource({ ghSeedlingMasterId: 10, progeny: "1", acidDeadlineDate: FUTURE, seedWeightInventory: 50 }),
    ];
    const recalc = vi.fn(async () => {});
    const summary = await generateTrayCodesForSelection(SEL, repo, recalc, NOW);
    expect(summary.inserts).toBe(0);
    expect(summary.cancelled).toBe(0);
    expect(repo.lastPlan).toEqual({ inserts: [], qtyUpdates: [], plateBackfills: [], shipZeros: [] });
    expect(recalc).not.toHaveBeenCalled();
  });

  it("shrinks a tray and zeroes orphans when a processed progeny's required drops", async () => {
    const repo = new FakeTrayRepository();
    // Required dropped so the progeny now computes a single 20-plant tray.
    repo.sources = [
      makeSource({ transplantsRequired: 20, ghSeedlingMasterId: 10, progeny: "1", seedWeightInventory: 5 }),
    ];
    repo.existing = [
      { uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 50, plateIndex: 1, berryId: 1, pollinationYear: 2026 },
      { uniqueTrayCode: "BK1.02", ghsmFk: 10, plantQty: 45, plateIndex: 2, berryId: 1, pollinationYear: 2026 },
    ];
    await generateTrayCodesForSelection(SEL, repo, vi.fn(async () => {}), NOW);
    // .01 shrinks 50→20; .02 orphaned → 0. No inserts, no deletes.
    expect(repo.lastPlan!.qtyUpdates).toEqual([
      { uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 20 },
      { uniqueTrayCode: "BK1.02", ghsmFk: 10, plantQty: 0 },
    ]);
    expect(repo.lastPlan!.inserts).toEqual([]);
  });

  it("plans no changes when everything already exists unchanged", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [
      makeSource({ transplantsRequired: 38, ghSeedlingMasterId: 10, progeny: "1", seedWeightInventory: 9 }),
    ];
    repo.existing = [
      { uniqueTrayCode: "BK1.01", ghsmFk: 10, plantQty: 38, plateIndex: 1, berryId: 1, pollinationYear: 2026 },
    ];
    await generateTrayCodesForSelection(SEL, repo, vi.fn(async () => {}), NOW);
    expect(repo.lastPlan).toEqual({ inserts: [], qtyUpdates: [], plateBackfills: [], shipZeros: [] });
  });
});

describe("previewTrayPipeline — read-only plan", () => {
  it("returns the plan without ever applying it", async () => {
    const repo = new FakeTrayRepository();
    repo.sources = [
      makeSource({ transplantsRequired: 96, ghSeedlingMasterId: 10, progeny: "1", seedWeightInventory: 30 }),
    ];
    const result = await previewTrayPipeline(SEL, repo, NOW);
    expect(repo.applyCalls).toBe(0); // never writes
    expect(result.sources).toBe(1);
    expect(result.built).toBe(1);
    expect(result.computedTrays).toBe(3);
    expect(result.plan.inserts).toHaveLength(3);
    expect(result.plan.qtyUpdates).toEqual([]);
    expect(result.plan.plateBackfills).toEqual([]);
    expect(result.plan.shipZeros).toEqual([]);
  });
});
