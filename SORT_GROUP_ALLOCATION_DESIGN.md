# Sort Group Allocation — Design & Handoff

**Status:** ✅ Integrated in DEV (2026-05-22). Migration applied, backend ported, frontend in place, smoke-tested against live GHSeed @ WVIDEVGBR-DB01. Pre-PROD: re-run the migration in PROD via DBA team, then deploy app.

## 1. What the screen is supposed to do

Per the README in `sort-group-allocation.zip` and the React page in the same package:

A new page (route `/propagation/sort-allocation`) where the user — gated on the global filters Berry + Pollination Team + Pollination Year — sees one card per eligible progeny showing its `Sort_Group_1..5` totals, and decides how to **split each total between the two destinations (D1 and D2)**. A single set of 5 dropdowns at the top (one per Sort Group) controls the split priority for the whole list — `EQUAL`, `D1`-priority, or `D2`-priority — and a "Save All" button writes every allocation in one PATCH.

## 2. Why the package can't be merged as-is

The zip contains a complete frontend + backend + codegen, but **the backend is not portable to this stack and the data model it assumes does not exist in the DB**. Specific issues found while auditing the zip:

| # | Issue | Detail |
|---|---|---|
| 1 | **Dialect mismatch** | `shipping.ts` uses Drizzle ORM with PostgreSQL syntax (`ILIKE`, `::int`, `selectDistinct`). This codebase is SQL Server via raw `mssql` with `queryMany` / `queryOne` / `withTransaction` helpers. |
| 2 | **PATCH writes through a non-updatable view** | `tx.update(vwGhDestinationShipping)` targets a view that is a `UNION ALL` over a CTE with computed/aggregate columns (`Sort_Group_1 = SUM(CASE WHEN Sort_Group = 1 …)`). SQL Server cannot UPDATE through this view. |
| 3 | **No per-destination data model** | `Sort_Group_1..5` are aggregations from `T_GHMarkerDiscards` keyed by `ghsm_FK` only — so the view *necessarily* returns the same values on the D1 and D2 rows of any progeny. There is no column anywhere to hold a per-destination split. |
| 4 | **`shippingId` doesn't exist as a unique row id** | The Drizzle PATCH calls `eq(shippingId, side.shippingId)` to target one row. The actual view exposes `GHSeedlingMaster_ID`, which is **identical** for the D1 and D2 rows of any progeny (only `Destination_Type 'D1'/'D2'` distinguishes them). |
| 5 | **Missing frontend utility** | `sort-allocation.tsx` imports `allocateSortGroups` and `Priority` from `@/lib/sortGroupAllocation`. That file is not in the zip and does not exist in this codebase. |

Issues 2, 3, and 4 cannot be fixed by porting — they require a real schema change. Issue 5 needs clarification from the package author about the splitting algorithm.

## 3. Proposed schema change

Add a thin new table `dbo.T_GHSortGroupAllocation` keyed by `(ghsm_FK, Destination_Type)`. The app reads and writes its splits here; nothing about the existing `vw_GH_Destination_Shipping` view or `T_GHMarkerDiscards` is touched.

### Migration script

See [`db-migrations/2026-05-21-sort-group-allocation.sql`](db-migrations/2026-05-21-sort-group-allocation.sql). Summary:

```sql
CREATE TABLE dbo.T_GHSortGroupAllocation (
    SortGroupAllocation_ID INT          IDENTITY(1,1) PRIMARY KEY,
    ghsm_FK                INT          NOT NULL REFERENCES M_GHSeedlingMaster ON DELETE CASCADE,
    Destination_Type       CHAR(2)      NOT NULL CHECK (Destination_Type IN ('D1','D2')),
    Sort_Group_1           INT          NOT NULL DEFAULT 0,
    Sort_Group_2           INT          NOT NULL DEFAULT 0,
    Sort_Group_3           INT          NOT NULL DEFAULT 0,
    Sort_Group_4           INT          NOT NULL DEFAULT 0,
    Sort_Group_5           INT          NOT NULL DEFAULT 0,
    Created_By             VARCHAR(100) NOT NULL,
    Created_DateTime       DATETIME     NOT NULL DEFAULT GETDATE(),
    Modified_By            VARCHAR(100) NULL,
    Modified_DateTime      DATETIME     NULL,
    CONSTRAINT UQ_GHSortGroupAllocation_ProgenyDest UNIQUE (ghsm_FK, Destination_Type),
    CONSTRAINT CK_GHSortGroupAllocation_NonNegative CHECK (… all five Sort_Group_N >= 0)
);
CREATE NONCLUSTERED INDEX IX_GHSortGroupAllocation_ghsm_FK
    ON dbo.T_GHSortGroupAllocation (ghsm_FK)
    INCLUDE (Destination_Type, Sort_Group_1..5);
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.T_GHSortGroupAllocation TO WebAppUser;
```

### Why a separate table (not new columns on an existing table)

- The Sort Group counts in the existing schema are *derived* from `T_GHMarkerDiscards`. Adding stored columns to that table would duplicate state and require synchronization logic.
- `T_GHShipQty` exists per `ghsm_FK` (one row per progeny, not per destination), so adding D1/D2 columns there would double the column count and conflate persisted Sort Group splits with the existing ship-quantity audit fields.
- A new dimension table is the cleanest and matches the existing pattern (`T_GHTransplantDaily`, `T_GHMarkerDiscards`, etc. all use this shape).

### Sum-to-source invariant (intentional design choice)

For any (progeny, sort group N): the *source-of-truth* total comes from `T_GHMarkerDiscards` and is what `vw_GH_MarkerProgenyDesk.Sort_GroupN` returns. The screen's split should normally satisfy:

```
T_GHSortGroupAllocation(ghsm_FK, 'D1').Sort_Group_N
  + T_GHSortGroupAllocation(ghsm_FK, 'D2').Sort_Group_N
  == vw_GH_MarkerProgenyDesk.Sort_GroupN
```

This invariant is **not** enforced as a CHECK constraint because the right-hand side depends on a join to an aggregation. The PATCH endpoint will:

1. Read the current source-of-truth total from `vw_GH_MarkerProgenyDesk` for each progeny being saved.
2. Reject the request (400) if any (D1 + D2) split exceeds the total.
3. Allow (D1 + D2) to be *less* than the total — that's the "extras / not shipped" case, mirroring existing patterns like `Extras_Not_Shipped` on `T_GHShipQty`.

### Why `ON DELETE CASCADE` on the FK to M_GHSeedlingMaster

Allocations have no meaning without their owning cross. If a cross is hard-deleted, leftover allocations are dead data and could cause FK joins to fail. If your house style is soft-delete only on `M_GHSeedlingMaster`, the cascade is dormant — harmless.

## 4. Backend integration plan (after migration is applied)

Once `T_GHSortGroupAllocation` exists, port the zip's two endpoints to this codebase's `mssql` style. Both go into `artifacts/api-server/src/routes/shipping.ts`.

### `GET /api/shipping/allocation`

Driven by global filters `berryId`, `teamId`, `pollinationYear`, plus optional `program` and `progeny` text filters. Returns one row per eligible progeny:

```sql
WITH eligible AS (
  SELECT mp.GHSeedlingMaster_ID, mp.Progeny, mp.Berry, mp.Team_Name, mp.Pollination_Year,
         mp.D1_Program, mp.D2_Program,
         mp.Sort_Group1 AS sg1, mp.Sort_Group2 AS sg2, mp.Sort_Group3 AS sg3,
         mp.Sort_Group4 AS sg4, mp.Sort_Group5 AS sg5
    FROM dbo.vw_GH_MarkerProgenyDesk mp
   INNER JOIN dbo.M_GHSeedlingMaster sm ON sm.GHSeedlingMaster_ID = mp.GHSeedlingMaster_ID
   WHERE sm.Berry_ID = @berryId
     AND sm.Team_ID  = @teamId
     AND mp.Pollination_Year = @py
     AND mp.D2_Program IS NOT NULL       -- only two-destination progenies
     AND COALESCE(mp.Sort_Group1,0) + COALESCE(mp.Sort_Group2,0)
       + COALESCE(mp.Sort_Group3,0) + COALESCE(mp.Sort_Group4,0)
       + COALESCE(mp.Sort_Group5,0) > 0  -- only progenies with sort groups
)
SELECT  e.GHSeedlingMaster_ID  AS ghsmId,
        e.Progeny              AS progeny,
        e.Berry                AS berry,
        e.Team_Name            AS teamName,
        e.Pollination_Year     AS pollinationYear,
        e.sg1 AS sortGroup1, e.sg2 AS sortGroup2, e.sg3 AS sortGroup3,
        e.sg4 AS sortGroup4, e.sg5 AS sortGroup5,
        e.D1_Program           AS d1Program,
        e.D2_Program           AS d2Program,
        ds1.Destination        AS d1Destination, ds1.Ship_Request AS d1ShipRequest,
        ds2.Destination        AS d2Destination, ds2.Ship_Request AS d2ShipRequest,
        a1.Sort_Group_1 AS d1AllocSg1, a1.Sort_Group_2 AS d1AllocSg2,
        a1.Sort_Group_3 AS d1AllocSg3, a1.Sort_Group_4 AS d1AllocSg4,
        a1.Sort_Group_5 AS d1AllocSg5,
        a2.Sort_Group_1 AS d2AllocSg1, a2.Sort_Group_2 AS d2AllocSg2,
        a2.Sort_Group_3 AS d2AllocSg3, a2.Sort_Group_4 AS d2AllocSg4,
        a2.Sort_Group_5 AS d2AllocSg5
   FROM eligible e
   LEFT JOIN dbo.vw_GH_Destination_Shipping ds1
          ON ds1.GHSeedlingMaster_ID = e.GHSeedlingMaster_ID AND ds1.Destination_Type = 'D1'
   LEFT JOIN dbo.vw_GH_Destination_Shipping ds2
          ON ds2.GHSeedlingMaster_ID = e.GHSeedlingMaster_ID AND ds2.Destination_Type = 'D2'
   LEFT JOIN dbo.T_GHSortGroupAllocation a1
          ON a1.ghsm_FK = e.GHSeedlingMaster_ID AND a1.Destination_Type = 'D1'
   LEFT JOIN dbo.T_GHSortGroupAllocation a2
          ON a2.ghsm_FK = e.GHSeedlingMaster_ID AND a2.Destination_Type = 'D2'
  ORDER BY e.Progeny;
```

The response shape mirrors the zip's `SortGroupAllocationRow` but with `ghsmId` (replacing the bogus `shippingId`) and persisted-split fields populated from `T_GHSortGroupAllocation` (NULL → fall back to 0 on the client). Progenies with no row in `T_GHSortGroupAllocation` yet are returned with all splits = 0 — the screen treats that as "needs allocating."

### `PATCH /api/shipping/allocation`

Requires `requireBreeder` (`UserLevel_FK >= 2`). Body shape:

```ts
{
  updates: Array<{
    ghsmId: number;
    d1: { sortGroup1: number; sortGroup2: number; sortGroup3: number; sortGroup4: number; sortGroup5: number };
    d2: { sortGroup1: number; sortGroup2: number; sortGroup3: number; sortGroup4: number; sortGroup5: number };
  }>;
}
```

For each update, in a single `withTransaction`:

1. Validate all 10 values are non-negative integers (also enforced by CHECK constraint as a defense-in-depth).
2. Query the source-of-truth totals from `vw_GH_MarkerProgenyDesk` (Sort_Group1..5 for this ghsm_FK). Reject 400 if `d1.sgN + d2.sgN > total` for any N.
3. UPSERT one row per side using `MERGE INTO dbo.T_GHSortGroupAllocation`. Sets `Modified_By = req.user.name`, `Modified_DateTime = GETDATE()` on update; `Created_By` on insert.

Returns `{ updatedCount: N }` where N is the number of rows affected across all UPSERTs.

### Pre-migration guardrail (in code)

Until the DBA applies the migration, the route can check `OBJECT_ID('dbo.T_GHSortGroupAllocation', 'U') IS NULL` at startup and:

- GET returns `{ data: [], pendingMigration: true }`.
- PATCH returns `503 { message: "Sort Group Allocation table not yet provisioned", pendingMigration: true }`.

That lets the frontend ship without a hard error and the screen renders the "no eligible progenies" empty state.

## 5. Frontend integration plan

Mostly portable as-is from the zip, with two caveats:

### `sort-allocation.tsx`

The page imports a `@/lib/sortGroupAllocation` helper that's **not in the zip**. The helper signature inferred from line 88 of the page:

```ts
export type Priority = 'EQUAL' | 'D1' | 'D2';

export function allocateSortGroups(args: {
  sortGroupTotals: number[];         // length 5
  d1ShipRequest: number;
  d2ShipRequest: number;
  priorities: Priority[];            // length 5
}): { d1: number[]; d2: number[] };  // both length 5
```

The semantic question the author has to answer: when `priority = 'D1'`, what algorithm distributes a sort group between D1 and D2? Plausible candidates:

- **"D1 gets first dibs up to its ship_request, leftover to D2"** — concrete and bounded, but depends on `d1ShipRequest` being meaningful for sort-group counts (a number of plants), and produces 0 for D2 if D1 can absorb everything.
- **"D1 gets the larger half of an equal split (ceiling), D2 the smaller (floor)"** — symmetric, doesn't depend on ship_request.
- **"100% to D1, 0% to D2"** — simplest, may be what users expect from a "priority" label.

The user/author needs to pick one before the page is usable. I recommend opening a question with the package author or the breeding team.

### `App.tsx` route

Two lines:

```tsx
import SortGroupAllocationPage from "@/pages/propagation/sort-allocation";
// ...
<Route path="/propagation/sort-allocation">{() => <ProtectedRoute component={SortGroupAllocationPage} />}</Route>
```

### Sidebar nav link

Add an entry under "Propagation Lifecycle" in `src/components/layout/Sidebar.tsx`. Suggested position: between `Ship` and the end of the section, since the screen is a planning step before shipping. Icon suggestion: `Split` or `GitFork` from lucide-react.

### i18n strings

The zip's four locale files add `nav.sortAllocation`, `propagation.sortAllocation.*` (page title, filter-gate copy, dropdown options, etc.), and `columns.sortAllocation.*` blocks. Diff each against the existing locale file and append — none of the existing keys are touched.

## 6. OpenAPI / codegen plan

The zip ships an entire regenerated `lib/api-client-react/src/generated/api.ts` and `api.schemas.ts`, plus eight new Zod files. Three concerns before copying:

1. **The schemas reference `shippingId`** (the bogus identifier from Issue 4). Replace with `ghsmId` — a single integer per progeny — and drop `shippingId` from all four schemas (`SortGroupAllocationRow`, `…Destination`, `…Split`, `…Update`).
2. **Re-run codegen rather than copying the generated files.** This repo runs Orval (`pnpm --filter @workspace/api-spec run codegen` per `replit.md`). After updating `openapi.yaml` with the `/shipping/allocation` paths and the four schemas (with `ghsmId` not `shippingId`), regenerate. That keeps the generated output in sync with all the *other* paths in this repo that may have drifted since the zip was produced.
3. **The Zod files in the zip will overwrite real generated files if copied wholesale.** Even if the migration is approved, prefer running codegen.

## 7. Integration order

Once everything in the design is approved:

1. **DBA applies** `db-migrations/2026-05-21-sort-group-allocation.sql`.
2. ~~Package author clarifies the `allocateSortGroups` algorithm and provides `src/lib/sortGroupAllocation.ts`~~ — **DONE** (2026-05-21). File landed at `artifacts/seedling-desktop/src/lib/sortGroupAllocation.ts` from `sortGroupAllocation-lib.zip`. Algorithm uses ship-request capacity caps with across-sort-group accounting; see file header. Dead code until the page imports it.
3. **Backend port**: rewrite `shipping.ts` GET + PATCH per Section 4, with the pre-migration guardrail.
4. **OpenAPI update**: add paths and schemas to `lib/api-spec/openapi.yaml`, run codegen.
5. **Frontend integration**: drop in `sort-allocation.tsx`, the App.tsx route, the Sidebar link, the i18n keys. (`sortGroupAllocation.ts` is already in place from step 2.)
6. **Smoke test against live DB**: create a known progeny, GET should return zero splits, PATCH should persist them, GET again should reflect them.

## 8. Files in scope (when integration happens)

| Path | Action |
|---|---|
| `db-migrations/2026-05-21-sort-group-allocation.sql` | New (this PR) — DBAs apply |
| `artifacts/api-server/src/routes/shipping.ts` | Modify — add 2 endpoints |
| `artifacts/seedling-desktop/src/lib/sortGroupAllocation.ts` | New — splitting helper (after algorithm decision) |
| `artifacts/seedling-desktop/src/pages/propagation/sort-allocation.tsx` | New — from zip, verbatim |
| `artifacts/seedling-desktop/src/App.tsx` | Modify — add route |
| `artifacts/seedling-desktop/src/components/layout/Sidebar.tsx` | Modify — add nav link |
| `artifacts/seedling-desktop/src/i18n/locales/{en,es,pt,ar}.json` | Modify — append new keys |
| `lib/api-spec/openapi.yaml` | Modify — add paths and schemas |
| `lib/api-client-react/src/generated/*` | Regenerate via Orval |
| `lib/api-zod/src/generated/*` | Regenerate via Orval |

## 9. Open questions for stakeholders

| For | Question |
|---|---|
| **DBA team** | Is the proposed table name `T_GHSortGroupAllocation` consistent with naming conventions? Is `ON DELETE CASCADE` acceptable, or should this be `ON DELETE NO ACTION` with a soft-delete model? Should `Modified_DateTime` default to `GETDATE()` like other audit tables? |
| **Package author / breeding team** | Concrete formula for `allocateSortGroups` when `priority = 'D1'` and `'D2'`? See Section 5. |
| **Product owner** | Should the PATCH endpoint enforce strict sum-to-source-total (reject undersum/oversum) or only oversum (allow leftover, mirror `Extras_Not_Shipped`)? Section 3 proposed "reject oversum, allow undersum"; confirm. |
| **Breeding team** | What does "Sort Group Allocation" mean in a screen with only one destination? The current zip filters those out (`D2 Program IS NOT NULL`). Confirm that's intentional — no allocation needed when there's only D1. |
