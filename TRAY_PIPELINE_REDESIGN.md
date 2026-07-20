# Tray Pipeline Redesign — Append-Only Tray Codes & Plate Indexes

**Status:** 🟢 Implemented & locally validated (2026-07-08), NOT yet committed. Phases 1–3 complete: 27 unit tests, clean typecheck/build, dev server boots against DEV, and a read-only dry-run against 15,859 live rows produced the expected plan (203 non-screened inserts with NULL plate index; 0 top-ups; 0 back-fills; nothing renumbered/deleted). Target file: `artifacts/api-server/src/services/tray-pipeline.ts` (+ `tray-pipeline.test.ts`).

---

## 0. Resolved decisions & final Phase-3 rules (2026-07-08)

Backed by a read-only audit of DEV `T_GHTraysCreation` (23,206 rows: 12,496 `GHTrayPipeline` all 2026 + 10,710 `GHTrayScript` 2025–2026; **all** codes correct 2-digit suffix; **zero** plate-index collisions; plate indexes dense & sequential per berry+year; 2027 empty).

- **D — Existing data → Freeze as baseline.** Data audits clean, so no destructive reconciliation. All existing rows are authoritative and permanent; new plates continue from `MAX(Plate_Index)+1` per `(Berry_ID, Pollination_Year)`. 2027 starts at 1.
- **A — Quantity increase → Top up `Plant_Qty`.** When recomputed trays include a code that already exists but with a higher plant count (a partial tray growing), `UPDATE` **only** that row's `Plant_Qty`. Never change `Unique_Tray_Code` or `Plate_Index`. New trays/plates still append at `MAX+1`.
- **C — Labels can be printed before screening.** So the only permitted mutations to an existing row are: `Plant_Qty` (top-up, per A) and a **NULL → value** `Plate_Index` back-fill (per below). A non-null `Plate_Index` and the `Unique_Tray_Code` are immutable.
- **C-transition — Non-screened → screened → Fill in later, never overwrite.** Generate tray codes for non-screened progenies with `Plate_Index = NULL`. When a progeny becomes screened, back-fill `Plate_Index` (NULL → value) on its existing trays, allocating from `MAX+1`. Never overwrite an existing non-null `Plate_Index` or a tray code.

**Net Phase-3 write rules (invariant):**
1. INSERT new trays (never seen before) — with `Plate_Index` if screened, else NULL.
2. UPDATE existing tray `Plant_Qty` when it grew (top-up).
3. UPDATE existing tray `Plate_Index` only when it is currently NULL and the progeny is now screened (back-fill).
4. Never DELETE. Never change a `Unique_Tray_Code`. Never change a non-null `Plate_Index`.

---

## 1. Purpose

The tray pipeline generates, for eligible crosses, the set of genotyping **trays** — each with a `Unique_Tray_Code` and (for screened progenies) a `Plate_Index` — and writes them to `dbo.T_GHTraysCreation`.

Downstream, **users export this data and print physical labels** for the trays/plates. The label is physically linked to its `Unique_Tray_Code` and `Plate_Index`. Therefore, once a row exists, **those two values must never change** — a changed value silently invalidates a printed label.

## 2. The problem with the current implementation

The current `runTrayPipeline()` (TS port of `Tray_Code_Generator2.0.py`) uses a **delete-and-recreate** strategy: on every run it deletes its own rows (`Created_By = 'GHTrayPipeline'`) for the current + next pollination year, then recomputes and re-inserts them.

This breaks the immutability requirement:

- **`Plate_Index` is allocation-order dependent** — assigned as `MAX(existing Plate_Index for berry+year) + rank-in-batch`. After the delete, `MAX` drops and batch composition/order changes, so **the same physical plate can be re-inserted with a different `Plate_Index`**. This is the primary risk.
- **`Unique_Tray_Code` is deterministic** (`berryCode + progeny + "." + zeroPad(suffix,2)`) so it is usually stable across recreation — but it is still needlessly re-derived, and would shift if source fields (berry/progeny/tray size) ever change.

Note: the **original Python was append-only** (it only ever did `df.to_sql(if_exists="append")` after an anti-join — no DELETE). The TS rewrite introduced the delete to clean up earlier buggy rows (wrong per-progeny `Plate_Index` grouping and a `.006` vs `.06` code-format mismatch — see the header comment in `tray-pipeline.ts`). **This redesign keeps those bug-fixes but removes the delete**, returning to an additive model.

## 3. Requirements

1. **Tray codes for all eligible progenies, including non-screened.** Generate `Unique_Tray_Code` regardless of screening status.
2. **Plate index only when screened.** Assign `Plate_Index` only when `SCREENING = 1`; leave `NULL` otherwise. (`Plate_Index` is nullable — confirmed against live DEV schema.)
3. **Never delete or recreate existing data.** On input changes (e.g. transplant quantity increases), compute the desired set and **insert only the new delta**, continuing `Plate_Index` from the current `MAX`.
4. **`Plate_Index` globally unique per `(Berry_ID, Pollination_Year)`,** never reused.
5. **Immutability:** existing `Unique_Tray_Code` and `Plate_Index` values are never mutated.

## 4. Confirmed facts (live DEV schema — `dbo.T_GHTraysCreation`)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `Tray_Creation_ID` | int | NO | Identity / PK |
| `Unique_Tray_Code` | varchar | YES | The tray code |
| `Plate_Barcode` | varchar | YES | **Not currently populated** by the pipeline — see §7.G |
| `Plant_Qty` | int | YES | Wells in the tray; not on the label |
| `ghsm_FK` | int | YES | → `M_GHSeedlingMaster.GHSeedlingMaster_ID` |
| `Test_Lab_ID` | int | YES | |
| `Pollination_Year` | int | YES | |
| `Plate_Index` | int | YES | **Nullable → non-screened can be NULL** |
| `Berry_ID` | int | YES | |
| `Created_By` / `Created_DateTime` / `Modified_By` / `Modified_DateTime` | | YES | `GHTrayScript` (Python) vs `GHTrayPipeline` (this service) |

**Open:** existing unique indexes/constraints on the table were not readable (SQL Server 2016 rejected the introspection query). Must confirm before relying on DB-level enforcement (§7.F).

## 5. Proposed design — additive / incremental

Replace delete-and-recreate with **compute desired → anti-join against existing → insert only the delta**. Existing rows are never touched.

### 5.1 Eligibility (source query)

Drop the `SCREENING = 1` filter (it currently excludes non-screened entirely). Proposed eligibility for a **tray code**: `ACTIVE = 1`, `Pollination_Year IN (current, next)`, and non-null `TRAY_SIZE` / `TRANSPLANTS_REQUIRED` / `Berry_ID` (+ lab as today). Carry `SCREENING` through so the plate-index step can branch on it. **Exact predicate needs confirmation — §7.E.**

### 5.2 Tray-code generation (unchanged math)

Keep `buildTraysForSource()` exactly as is — it is deterministic and already matches the Python:

```
traysPerPlate  = ceil(plateSize / traySize)
plateIdx       = floor(wellSeq / plateSize) + 1     (within progeny)
wellInPlate    = (wellSeq % plateSize) + 1
trayInPlate    = min(ceil(wellInPlate / traySize), traysPerPlate)
suffix         = (plateIdx - 1) * traysPerPlate + trayInPlate
UniqueTrayCode = berryCode + progeny + "." + zeroPad(suffix, 2)
```

Because the tray set is a pure function of the plant count, increasing `TRANSPLANTS_REQUIRED` only ever *appends* higher-suffix trays; existing lower-suffix trays are byte-identical.

### 5.3 Anti-join (no delete)

Read existing rows for the affected years and skip any tray whose `(Unique_Tray_Code, ghsm_FK)` already exists. Only genuinely-new trays proceed to insert. This is the Python's original model.

### 5.4 Plate-index allocation (incremental, screened-only)

- Only trays whose progeny has `SCREENING = 1` receive a `Plate_Index`; others insert with `Plate_Index = NULL`.
- For each `(Berry_ID, Pollination_Year)`, read `MAX(Plate_Index)` across **all** rows (script + pipeline) and assign new physical plates `MAX + 1, MAX + 2, …` in a deterministic order.
- Because nothing is ever deleted, `MAX` is a stable high-water mark, so indexes are never reused → satisfies global uniqueness per berry+year.

### 5.5 Insert

Insert only the delta rows (`Created_By = 'GHTrayPipeline'`). No UPDATE, no DELETE.

## 6. Trigger (button-driven, deadline-gated) — updated 2026-07-20

The event-driven `scheduleTrayPipeline()` (10s debounce, fired from `crosses.ts` / `reference-tables.ts` / `transplant.ts`) has been **removed**. Generation is now triggered on demand from the Transplant page's **"Export Tray Codes and Plate Indexes CSV"** button, which generates rows and then exports them (with a confirmation dialog). The button is greyed out (UI-only) until the user is **Admin3 (`UserLevel_FK = 4`)** and a **berry**, a **single team**, and a **year** are all selected.

`generateTrayCodesForSelection({ berryId, teamId, pollinationYear })` (in `tray-pipeline.ts`) is the entry point, backing `POST /api/transplant/generate-tray-codes`. It is scoped to the one selection (not a two-year, all-berry sweep) and applies the eligibility rules below.

**Eligibility (per progeny, via `vw_GHSeedDesk`):**
- Seed-acid deadline must have **passed** (`Acid_Deadline_Date <= now`); NULL/future → skipped. Applies to screened and non-screened alike.
- Deadline passed + `Seed_Weight_Inventory > 0` → build/top-up tray codes.
- Deadline passed + `Seed_Weight_Inventory = 0` → **cancel**: zero the six inputs to `TOTAL_SEEDLING_SHIP_REQUEST_Calc` (`D1/D2_SEEDLING_SHIP_REQUEST`, `Breeder_Requested_ShipDest1/2_Adjustments`, `D1/D2_Transplant_Adjustment`) and re-run the table-wide required-amount recalc once.

**Non-screened tray math:** non-screened progenies are **not** capped by plate size — trays = `ceil(TRANSPLANTS_REQUIRED / TRAY_SIZE)`, sequential suffixes, NULL `Plate_Index`. Screened progenies keep the plate-capped math. New `Plate_Index` values are allocated in **ascending PROGENY** order, continuing from `MAX+1`.

## 7. Open decisions (MUST resolve before implementation)

> These were raised on 2026-07-07 and are **not yet answered**. Recommended defaults are marked; all need confirmation.

**A. Top-up of a partially-filled last tray on quantity increase.** When `TRANSPLANTS_REQUIRED` grows, the previously-last tray may have been partially full (e.g. 20/38). Options: (a) leave all existing rows untouched and route new plants only into brand-new trays — simplest and fully immutable, but the old last tray stays under-filled; (b) `UPDATE` only that tray's `Plant_Qty` (safe-ish, since `Plant_Qty` is not on the label). **Recommended: (a)** for a strict no-mutation guarantee. *Needs confirmation.*

**B. Quantity decrease.** **RESOLVED (2026-07-20): Plant_Qty now syncs in BOTH directions.** A decrease updates the matching existing trays *down*, and any existing tray the new computation no longer produces is set to **Plant_Qty = 0** (never NULL). The row, `Unique_Tray_Code`, and `Plate_Index` are still never deleted or renumbered. Safe because `Plant_Qty` is not printed on the physical label. Orphan-zeroing is scoped to the progenies actually processed in the run (`syncGhsmFks`), so trays of out-of-scope progenies are untouched.

**C. Non-screened → later screened (back-fill Plate_Index).** A progeny may get a tray code with `Plate_Index = NULL`, then have screening turned on. Filling in a Plate_Index later is a `NULL → value` UPDATE — **only safe if no label was printed while it was non-screened.** → **Key workflow question: are labels ever exported before the screening decision is final?** If no, back-fill is safe. If yes, we need a different rule. *Needs answer.*

**D. Existing-data reconciliation (highest-risk item).** The old delete silently cleaned up previously-buggy `GHTrayPipeline` rows. Once we stop deleting, whatever is in the table becomes **permanent** and feeds both the anti-join and `MAX(Plate_Index)`. Before switching to append-only we must audit existing rows: which are real / label-printed (untouchable) vs. buggy leftovers to correct — likely a **DBA-coordinated one-time cleanup**. Otherwise bad `Plate_Index` values are locked in forever. *Needs owner + plan.*

**E. Precise tray-code eligibility predicate** (§5.1). **RESOLVED (2026-07-08):** `ACTIVE = 1`, `Pollination_Year IN (cur, next)`, `TRAY_SIZE`/`TRANSPLANTS_REQUIRED`/`Berry_ID` all NOT NULL. The old `Testing_Lab_1_FK IS NOT NULL` filter was **dropped** — non-screened progenies have no testing lab (e.g. progeny 2026-265) but still need tray codes; without a lab, `Test_Lab_ID` is NULL and plate size defaults to 96. Verified via dry-run: non-screened sources 53 → 297; 2026-265 now builds 8 trays with NULL plate index.

**F. Concurrency & DB-level enforcement.** `MAX + rank` read-then-insert can race if two runs overlap. Recommended safeguards: run allocation inside a transaction with appropriate locking (or an app-level mutex), **and** add unique constraints as a hard backstop — `(Unique_Tray_Code, ghsm_FK)` and `(Berry_ID, Pollination_Year, Plate_Index)` (the latter filtered to non-NULL). Requires confirming what constraints already exist (§4). *Needs DBA input.*

**G. `Plate_Barcode` column.** Present but unpopulated. Clarify whether labels use it and whether the pipeline should set it.

## 8. Testing plan ("and test")

Refactor toward the repository interface the Python already defined (`TrayRepository`) so allocation logic is a pure function fed fakes — the current TS calls `queryMany`/`withTransaction` inline and is hard to test. Then cover:

- **Pure tray math** — counts / suffix / code for representative `(total, plateSize, traySize)` inputs (e.g. 96/38 → 3 trays/plate).
- **Incremental append** — given existing rows, a quantity increase inserts only the new trays; existing rows are byte-for-byte unchanged; `Plate_Index` continues from `MAX`.
- **No-mutation invariant** — pipeline issues no `DELETE` and no `UPDATE` to `Unique_Tray_Code` / `Plate_Index` of existing rows.
- **Non-screened** → `Plate_Index = NULL`; **screened-later** → back-fill per decision C.
- **Idempotency** — a second run with no input changes inserts nothing.
- **Uniqueness** — `Plate_Index` unique per `(Berry_ID, Pollination_Year)` across multiple runs.
- **Concurrency** — two overlapping runs never collide on `Plate_Index`.

## 9. Summary of the change

| Aspect | Current (TS) | Proposed |
|---|---|---|
| Existing rows | Deleted & recreated each run | Never touched |
| Model | Delete → recompute → insert | Compute → anti-join → insert delta |
| Non-screened progenies | Excluded entirely | Tray code yes, `Plate_Index` NULL |
| `Plate_Index` on qty increase | Can change | Continues from MAX, stable |
| Label linkage | Can silently break | Preserved (immutable) |
| Matches original Python | No (Python was append-only) | Yes (append-only + TS bug-fixes kept) |

---

### Appendix — reference locations

- Running logic: `artifacts/api-server/src/services/tray-pipeline.ts`
- Original Python (paste, git-tracked): `attached_assets/Pasted--Trays-pipeline-Purpose-Generate-new-Unique-Tray-Code-r_1774389701524.txt`
- Trigger: `generateTrayCodesForSelection()` via `POST /api/transplant/generate-tray-codes`, from the Transplant page's Admin3-gated export button (no automatic triggers)
- Target table: `dbo.T_GHTraysCreation`
