# Workspace

## Overview

Seedling Desktop — a React+Vite frontend with Express/**SQL Server** backend replacing Driscoll's Power Apps "GH Seedling App" for greenhouse seedling cross management.

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (wouter routing, TanStack React Query, Tailwind CSS v4, shadcn/ui, Recharts, framer-motion, i18next/react-i18next)
- **API framework**: Express 5
- **Database**: Microsoft SQL Server — driver: `mssql` (tedious); raw parameterised SQL with typed `queryOne<T>` / `queryMany<T>` / `execute` / `withTransaction` helpers in `lib/db/src/query.ts`. No ORM. Reads use `vw_*` views (read-only); writes go to base tables (`M_GHSeedlingMaster`, `T_GHParentInventory2`). Cross-DB reads to `TPN.dbo.M_BerryID`, `TPN.dbo.M_Locations`, `TPN.dbo.M_SrcBreedingProgram` via fully-qualified names.
- **Validation**: Zod (`zod/v4`). API contract defined in `lib/api-zod` from the OpenAPI spec.
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle for API server)

## Environment Variables

```
SQL_SERVER=WVIDEVGBR-DB01,1433   # host[,port]  (tcp: prefix optional)
SQL_DATABASE=GHSeed
SQL_USER=WebAppUser              # empty = Windows Auth
SQL_PASSWORD=...                 # empty = Windows Auth
SQL_ENCRYPT=false                # "true" in prod if cert is trusted
SQL_TRUST_CERT=true              # accept self-signed certs (dev)
PORT=8080
TOKEN_SECRET=...                 # HS256 secret for Seedling-Manager's own tokens
UPLOAD_JWT_SECRET=...            # shared with the Flask upload app
UPLOAD_APP_URL=http://localhost:5000
ENABLE_NOTIFIERS=false           # set "true" to start daily cron jobs
```

## Design

- **Primary color**: Deep teal/slate blue — NO red in the theme
- **Auth**: Employee dropdown + 4-digit code (Employee_Num); UserLevel_FK > 2 = admin; Base64 token stored in localStorage; pre-auth GET /employees returns only id+name (no sensitive fields); all mutation routes protected by `requireAdmin` middleware + Zod body validation
- **Global filters** (React context): Berry dropdown (BLACK/BLUE/RASP/STRAW), Pollination Team (from M_GHTeams), Pollination Year (2025–2032), SP Crosses checkbox
- **DB column names**: Match spreadsheet exactly; integer 0/1 used for boolean fields (except Selections table uses native boolean)
- **Expected Discard %**: Stored as decimal (0.5 = 50%), displayed as percentage
- **DataTable**: Totals row, pagination (25/50/100), Export CSV, alternating grey rows, sort arrows, frozen Progeny column, inline editing (text/number/dropdown) with batch save, action bar slot, row click handler
- **Charts**: Recharts (bar, line) — NO Power BI
- **i18n**: i18next + react-i18next + i18next-browser-languagedetector; 4 languages (English, Spanish, Portuguese, Arabic); RTL support for Arabic via DirectionHandler in App.tsx; language switcher globe icon in Topbar; translation files at `src/i18n/locales/{en,es,pt,ar}.json`; all pages/components use `useTranslation()` hook with `t('key')` pattern

## Navigation

- **Home**: Dashboard with summary cards and Recharts charts
- **Analytics**: 5 tabs (Pollinations, Seed, Transplants, Ship, Markers); first 4 tabs have 4 bar charts comparing done vs required grouped by Program, Destination, Team, and Pollination Year; global filters apply; "Cap at required" toggle excludes extras beyond required per progeny; lifecycle completion checkmarks show green "Complete" badge on chart cards when all Berry/Team/Year combinations for filtered data are marked done in T_LifecycleStatus (API: `GET /api/lifecycle-status/completion?berryId=&teamId=&pollinationYear=&spCrosses=true`); API: `/api/analytics/{pollination|seed|transplant|ship}?groupBy={program|destination|team|year}&capExtras=true`. Markers tab: 4 charts (By Program, By Berry, By Team, By Pollination Year) with 3 series (Allocation from M_GHMarkerAllocation, Cross List from vw_GH_CrossesDesk total_marker*transplants_required, Actual from vw_GH_MarkerPlateDesk samples_collected); 5th full-width chart "Markers Planned — By Type" unpivots Marker_1..6 × TRANSPLANTS_REQUIRED; local filters: Program, Lab, Samples/Cost toggle; API: `/api/analytics/markers?groupBy=program|berry|team|year&metric=sample|cost&programId=&labId=`, `/api/analytics/markers-planned-by-type?programId=`
- **Crosses**: Short List (26 cols, inline editing, page filters), Full List (64+ cols, inline editing, flags), Cross Form (create/edit with searchable parent dropdowns), Parents (CRUD with modal dialog). Both Short and Full lists have Template Download (blank .xlsx) and Upload (parse .xlsx → create new crosses) buttons; upload requires Breeder+ role; template served from `/api/public/Crossing_File_Template.xlsx`; upload endpoint: `POST /api/crosses/upload` (multipart, multer)
- **Propagation Lifecycle**: Lifecycle Summary (Berry/Team/Year combinations with progeny counts and 7 checkboxes: Pollen, Pollination, Fruit, Seed, Transplant, Screen, Ship; Admin3+ only; stored in T_LifecycleStatus), Pollen (16 cols, read-only, totals, CSV export, pollen-to-go filter), Pollination (12 cols, read-only, totals, CSV export, pollination-to-go filter), Fruit (8 cols, inline editing, CSV export, fruit-to-go filter), Seed (18 cols, read-only, totals, CSV export, filters: progeny search, program, seed-sow-to-go, sow-seed, acid-date-range; dynamic acid/GA labels for blueberry), Transplant (21 cols, read-only, conditional cell coloring red/green for transplant status, totals row from dedicated API, CSV export, filters: progeny search, program, destination, available-plants>0; backed by vw_GH_TransplantDesk view, API: GET /api/transplant + /api/transplant/totals), Screen by Plate (16 cols, read-only, totals, CSV export, filters: progeny, program, testing lab, plate index#, screening, sorted), Screen by Progeny (18 cols, read-only, totals, CSV export, filters: progeny, program, screening, sorted), Ship (16 cols, read-only, totals, CSV export, filters: progeny, program, destination, shipped)
- **Tray Pipeline**: Auto-generates `T_GHTraysCreation` rows when crosses or ratios are created/updated/deleted. Triggered with 10-second debounce from all crosses mutations (create, update, batch, delete, upload) and ratios mutations (create, update, delete). Pipeline: fetches eligible crosses (Active=1, SCREENING=1, current/next year), computes unique tray codes per (BerryCode, Progeny, plate, tray), anti-joins against existing trays, allocates Plate_Index continuing from DB MAX, and bulk-inserts. Idempotent via (Unique_Tray_Code, ghsm_FK) dedup. Service: `artifacts/api-server/src/services/tray-pipeline.ts`.
- **Reference Tables**: Labs, Teams, Trays, Ratios (CRUD with 21-col DataTable, Team/Program filters, admin New/Edit/Delete modals), Deadlines (CRUD with 23-col DataTable showing week numbers for each lifecycle stage, Team/Destination/Program filters, admin New/Edit/Inactivate modals, soft-delete), Employees (CRUD with DataTable showing name/number/team/email/userLevel/active/modified, Team and Active filters, admin New/Edit/Inactivate modals, soft-delete, user level labels), Marker List, Marker Allocations (inline-editable table with Berry/Program/Lab/Team dropdowns, Sample/Cost allocation totals, Program and Lab filters, Admin3/Molecular can edit/add/delete rows; API: GET/POST/PUT/DELETE `/api/marker-budgets`), Marker Prices (inline-editable table with Berry/Genotyping Screen/Lab dropdowns, Sample Price, Year; Genotyping Screen and Lab filters; Admin3/Molecular can edit/add/delete rows; data from vw_GH_Lab_Information/M_GHLabPrice; API: GET/POST/PUT/DELETE `/api/lab-prices`, GET `/api/genotype-screens`)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server (port 8080)
│   ├── seedling-desktop/   # React + Vite frontend (preview at "/")
│   └── mockup-sandbox/     # Component preview server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # SQL Server pool + typed query helpers + row types
├── scripts/                # Utility scripts
│   └── src/
│       └── hello.ts
├── attached_assets/        # Excel data file for seeding
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema (15 tables)

- **M_BerryID** — Berry types (BLACK, BLUE, RASP, STRAW)
- **M_GHTeams** — Greenhouse teams
- **M_SrcBreedingProgram** — Source breeding programs
- **M_Locations** — Destinations/locations
- **M_GHRatios** — Propagation ratio calculations
- **M_GHTraySize** — Tray sizes
- **M_GHLabs** — Testing labs
- **M_Transplant_Instruct** — Transplant instructions
- **T_GHEmployees** — Employee accounts
- **T_GHParentInventory2** — Parent plant inventory
- **vw_GH_CrossesDesk** — Main crosses table (stored as actual table, not DB view)
- **Selections** — Plant selections
- **Markers** — Genetic markers
- **vw_GHPollenDesk** — Pollen tracking
- **vw_GH_FruitDesk** — Fruit tracking (SQL Server view over M_GHSeedlingMaster)
- **vw_GH_PollinationDesk** — Pollination tracking (SQL Server view with pre-calculated Flowers_Pollinated_Variance_Calc and Emasculated_Variance_To_Flowers_Calc)
- **M_GH_Deadlines** — Deadline management

## API Routes (all under /api)

- `POST /auth/login` — Login with employeeId + employeeNum
- `GET /auth/me` — Get current user from Bearer token
- `GET /employees` — List employees (filterable by active)
- `GET /crosses` — List crosses with pagination, sorting, filters (berry, team, year, spCrosses, progeny, parent, program, destination, active, fumigated, fruitToGo, pollinationToGo)
- `GET /crosses/totals` — Aggregated totals for crosses (includes fruit totals: reciprocalDone, fruitRequired, totalFruitCollected, fruitToGo)
- `PATCH /crosses/batch` — Batch update crosses (inline edits: destinations, adjustments, discards, comments, reciprocalDone, totalFruitCollected)
- `GET /parents` — List parent inventory
- `GET /parents/validate` — Validate parent selections
- `GET /pollen` — Pollen tracking data (filterable by berry, team, year, spCrosses, selection, pollenToGo)
- `GET /pollination` — Pollination data from vw_GH_PollinationDesk (filterable by berry, team, year, spCrosses, progeny, parent, program, active, pollinationToGo, emasculationToGo)
- `GET /pollination/totals` — Aggregated pollination totals
- `GET /fruit` — Fruit data from vw_GH_FruitDesk (filterable by berry, team, year, spCrosses, progeny, parent, program, active, fruitToGo)
- `GET /fruit/totals` — Aggregated fruit totals
- `GET /dashboard/summary` — Dashboard summary stats
- Reference table CRUD: `/berries`, `/teams`, `/programs`, `/locations`, `/ratios`, `/trays`, `/labs`, `/transplant-instructions`, `/employees`, `/selections`, `/markers`, `/deadlines`

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — `pnpm run typecheck`
- **`emitDeclarationOnly`** — only emit `.d.ts` files; actual JS handled by esbuild/tsx/vite
- **Project references** — when package A depends on B, A's `tsconfig.json` must list B in `references`

## Root Scripts

- `pnpm run build` — typecheck first, then recursively build
- `pnpm run typecheck` — `tsc --build --emitDeclarationOnly`

## Packages

### `artifacts/seedling-desktop` (`@workspace/seedling-desktop`)

React + Vite frontend with sidebar navigation, global filter context, auth context, and page routing via wouter v3.

- Entry: `src/main.tsx`
- App: `src/App.tsx` — QueryClient, AuthProvider, FilterProvider, WouterRouter
- Contexts: `src/contexts/AuthContext.tsx`, `src/contexts/FilterContext.tsx`
- Pages: `src/pages/` — login, home, crosses/list-short, crosses/list-full, crosses/form, crosses/parents, propagation/pollen, propagation/pollination, propagation/fruit, stub, not-found
- Components: `src/components/ui/` — shadcn components, DataTable (with inline editing), InactivateDialog
- Depends on: `@workspace/api-client-react`

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server with all route handlers.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App: `src/app.ts` — mounts CORS, JSON, routes at `/api`
- Routes: `src/routes/` — auth, crosses, parents, pollen, dashboard, reference-tables, health
- Jobs: `src/jobs/acid-treat-notifications.ts` — Daily cron (6 AM) checks vw_GHSeedDesk for Acid_Start_Date or Acid_Deadline_Date arriving tomorrow, finds Admin3 (level 4) employees on matching teams, logs email notifications (email sending not yet wired — needs Outlook SMTP credentials). Also runs on server startup.
- Depends on: `@workspace/db`, `@workspace/api-zod`, `node-cron`

### `lib/db` (`@workspace/db`)

SQL Server data-access layer.  Uses the `mssql` (tedious) driver directly —
no ORM.  Connection pool + typed query helpers + row-shape interfaces.

- `src/index.ts` — `getPool()` singleton from `SQL_SERVER` / `SQL_DATABASE` / `SQL_USER` / `SQL_PASSWORD` env vars
- `src/query.ts` — `queryOne<T>`, `queryMany<T>`, `execute`, `callProc`, `withTransaction`, `paginate` helpers with `@paramName` parameterisation
- `src/types.ts` — Row-shape interfaces matching actual SQL Server column names (snake_case / PascalCase, not camelCase)
- Schema is owned by the SQL Server DBAs; the app does not push migrations

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec and Orval codegen config.

- Codegen: `pnpm --filter @workspace/api-spec run codegen`

### `scripts` (`@workspace/scripts`)

- `seed.ts` — Import seed data from Excel (attached_assets/)
- Run: `pnpm --filter @workspace/scripts run seed`
