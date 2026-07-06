# Seedling Desktop — User Manual

**Driscoll's GH Seedling App**
*Greenhouse Seedling Cross Management System*

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Navigation & Layout](#2-navigation--layout)
3. [Global Filters](#3-global-filters)
4. [Home Dashboard](#4-home-dashboard)
5. [Analytics](#5-analytics)
6. [Crosses](#6-crosses)
   - 6.1 [Crossing List (Simplified)](#61-crossing-list-simplified)
   - 6.2 [Crossing List (Full)](#62-crossing-list-full)
   - 6.3 [Cross Form (Add / Edit / Copy)](#63-cross-form-add--edit--copy)
   - 6.4 [Parent Inventory](#64-parent-inventory)
7. [Propagation Lifecycle](#7-propagation-lifecycle)
   - 7.1 [Lifecycle Summary](#71-lifecycle-summary)
   - 7.2 [Pollen](#72-pollen)
   - 7.3 [Pollination](#73-pollination)
   - 7.4 [Fruit](#74-fruit)
   - 7.5 [Seed](#75-seed)
   - 7.6 [Transplant](#76-transplant)
   - 7.7 [Screening (by Progeny)](#77-screening-by-progeny)
   - 7.8 [Screening (by Plate)](#78-screening-by-plate)
   - 7.9 [Sort Group Allocation](#79-sort-group-allocation)
   - 7.10 [Ship](#710-ship)
8. [Reference Tables](#8-reference-tables)
   - 8.1 [Labs](#81-labs)
   - 8.2 [Teams](#82-teams)
   - 8.3 [Trays](#83-trays)
   - 8.4 [Ratios](#84-ratios)
   - 8.5 [Deadlines](#85-deadlines)
   - 8.6 [Employees](#86-employees)
   - 8.7 [Marker List](#87-marker-list)
   - 8.8 [Marker Allocations / Budget](#88-marker-allocations--budget)
   - 8.9 [Marker Prices](#89-marker-prices)
9. [Language Support](#9-language-support)
10. [User Roles & Permissions](#10-user-roles--permissions)
11. [Tips & Shortcuts](#11-tips--shortcuts)

---

## 1. Getting Started

### Logging In

1. Open the Seedling Desktop app in your web browser.
2. On the login screen, select your **name** from the dropdown list.
3. Enter your **4-digit PIN** (your Employee Number).
4. Click **Login**.

If your PIN is incorrect, an error message will appear. Contact an administrator if you need your PIN reset.

### First-Time Users

Your administrator must create your employee account in the **Employees** reference table before you can log in. You will need:
- Your name added to the system
- A 4-digit Employee Number assigned (this is your PIN)
- An appropriate User Level assigned (see [Section 10](#10-user-roles--permissions))

---

## 2. Navigation & Layout

The app uses a **sidebar** on the left side of the screen for navigation. The sidebar is organized into four sections:

| Section | What It Contains |
|---------|-----------------|
| **Home & Analytics** | Dashboard overview and detailed charts |
| **Crosses** | Cross records, parent inventory, and the cross form |
| **Propagation Lifecycle** | Stage-by-stage tracking from pollen through shipping |
| **Reference Tables** | System configuration data (teams, labs, markers, etc.) |

**Sidebar Controls:**
- Click the **pin icon** to keep the sidebar always visible, or let it collapse automatically.
- Click your **user avatar** at the bottom to log out.

The **top bar** contains the global filters (see next section) that apply across all pages.

---

## 3. Global Filters

The top bar contains persistent filters that affect data across every page:

| Filter | Description |
|--------|-------------|
| **Berry Type** | Filter by berry (e.g., Strawberry, Blueberry, Raspberry, Blackberry) |
| **Team** | Filter by breeding team |
| **Pollination Year** | Select the target pollination year |
| **SP Crosses** | Toggle to show/hide SP (specific) crosses |

These filters stay active as you navigate between pages. To see all data, clear any active filters.

---

## 4. Home Dashboard

The dashboard provides a quick overview of the current breeding season's progress.

### Progress Cards

Four color-coded progress cards are displayed at the top:

1. **Pollination Progress** — Percentage of pollinations completed vs. required
2. **Seed Progress** — Seed collected (grams) vs. required
3. **Transplant Progress** — Seedlings transplanted vs. required
4. **Ship Progress** — Seedlings shipped vs. total requested

Each card shows a progress bar that shifts from red (behind schedule) to green (on track or complete).

### Charts

- **Crosses by Berry Type** — A bar chart showing the number of active crosses for each berry type.
- **Propagation Funnel** — A funnel chart that visualizes how volume flows through the stages: Ship Request → Transplants Required → Pollinations Required → Crosses.

---

## 5. Analytics

The Analytics page provides more detailed charts and breakdowns beyond the dashboard summary.

### Available Charts

- **Pollinations, Seed, Transplants, and Shipping** — Grouped bar charts that can be filtered by Program, Destination, Team, or Year.
- **Marker Analytics** — Compares Marker Totals (Allocated vs. Cross List vs. Actual) and shows Markers Planned by Type.
- **Parent Analytics** — Charts for female and male parent performance including Seed Weight and Fruit Percentage.

Use the dropdown controls on the page to switch between different chart groupings.

---

## 6. Crosses

### 6.1 Crossing List (Simplified)

A condensed table showing the most commonly referenced cross data.

**Key Columns:**
- Progeny name, Destination 1 & 2, Ship Requests, Adjustments
- Total Ship Requirement, Estimated Plants to Ship, Est Ship # (from Seed)
- Transplant progress (Done vs. Required), Extra Trays Available
- Markers, Seed data, Parent counts, Plant Date

**Color Coding:**
- **Est Ship # (from Seed)** column: Green background if the estimated number meets or exceeds the Total Ship Requirement; red background if it falls short.
- **D1/D2 Adj +/-** columns: Amber highlight when adjustments have been entered.

**Actions:**
- **Add Cross** button (if you have Breeder-level permissions or higher)
- **Full List** button to switch to the comprehensive view
- Row-level actions: **Edit**, **Copy as New**, **Inactivate**

**Inline Editing** (Breeder level and above):
- Destination 1 & 2, Adjustments, Expected Discard %, Spiny Discard %

**Filters:**
- Search by Progeny name
- Filter by Program, Destination
- Active checkbox (checked = active records only; unchecked = inactive records only)
- Fumigated checkbox

### 6.2 Crossing List (Full)

The comprehensive table showing all cross data fields.

This view contains all the columns from the Simplified list, plus:
- Parent 1 & 2 names, Berry type, Team
- Screening status and Marker 1–6 assignments, Lab 1–2
- Seed details (Sow Seed?, Seed Sown, Seed Weight Required/Inventory)
- Fruit and Flower data (Required vs. Collected/Pollinated)
- Parent layer details (P1/P2 L1–L4 field codes and counts)
- Reciprocal Done status, Fumigated status, SP Crosses
- Breeder Comments and GH Team Comments (both inline editable)
- Cross Designed By, Plant Year, Pollination Year

**Inline Editing** (Breeder level and above):
- Destination 1 & 2, D1/D2 Adjustments, Expected Discard %, Spiny Discard %
- Breeder Comments, GH Team Comments

**Batch Save:** After making inline edits across multiple rows, click the **Save** button to submit all changes at once.

### 6.3 Cross Form (Add / Edit / Copy)

The form for creating a new cross, editing an existing one, or copying an existing cross to create a new record.

**Sections:**

**Cross Info:**
- Berry type, Progeny name, Pollination Year, Pollination Team
- Parent 1, Parent 2, and Bulk Parent 3 (searchable dropdowns)
- Reciprocal Allowed toggle, SP Crosses toggle
- Cross Designed By

**Destinations & Shipping:**
- Location, Program, Ship Request, Ship Adjustment, Field Plant Date — for both Destination 1 and Destination 2

**Screening & Markers:**
- Screening toggle
- Marker 1–6 (filtered by selected berry type)
- Lab 1–2

**Calculations Panel:**
- A read-only panel showing the calculated propagation requirements based on the cross settings and reference ratios.

**Modes:**
- **Add:** All fields are editable. A new cross is created on save.
- **Edit:** Some fields are locked (Berry, Progeny, Pollination Year/Team, Ship Request). Other fields can be updated.
- **Copy as New:** All data is pre-filled from an existing cross, but you must enter a new Progeny name. A new record is created on save.

### 6.4 Parent Inventory

Manages the parent plant inventory used in crosses.

**Columns:**
- Selection name (the parent variety)
- L1 Field Code & L1 Count (primary location)
- L2–L4 Field Codes & Counts (additional locations, toggleable with the **Show/Hide L2–L4** button)
- Total Parents, Parents Required
- Year, Comments, Berry, Team, SP Crosses, First Year

**Row Highlighting:**
- Rows are highlighted in red if the parent does not have sufficient plants to meet requirements.

**Actions:**
- **Add Parent** — Opens a dialog to create a new parent record with location and count details.
- **Edit** — Opens a dialog to update an existing parent's locations and inventory.
- **Delete** — Removes a parent record.
- **Reset Filters** — Clears all active search and filter criteria.

---

## 7. Propagation Lifecycle

The Propagation Lifecycle pages track the progress of crosses through each stage of the breeding process, from pollen collection to final shipping.

### 7.1 Lifecycle Summary

A high-level checklist showing the completion status of each lifecycle stage.

**Stages Tracked:**
Pollen → Pollination → Fruit → Seed → Transplant → Screen → Ship

**Features:**
- Checkboxes indicate whether each stage is marked as "Done" for a given Berry/Team/Year combination.
- Administrators can toggle the status of any stage.
- Each entry shows who last modified the status and when.

### 7.2 Pollen

Tracks flower collection and pollen availability for each parent plant.

**Key Columns:**
- Parent selection, Flowers Required for Pollen, Total Flowers Collected
- Pollen Available, Pollen Used, Bad Pollen
- L1–L4 Field Codes and collection counts (L2–L4 can be shown/hidden)

**Special Features:**
- **Pollen To Go** filter — Highlights parents that still need more flowers collected.
- **Totals Row** — Displays sum totals for key numeric columns (excluding L1–L4).

### 7.3 Pollination

Monitors the execution of crosses between parent plants.

**Key Columns:**
- Progeny, Parent 1, Parent 2, Bulk Parent 3
- Pollination Required, Successful Pollinations, Emasculation To Go
- Reciprocal Done status

**Special Features:**
- **Label Export** — Export a CSV file for printing labels used in the field during pollination.

### 7.4 Fruit

Tracks fruit collection progress after successful pollinations.

**Key Columns:**
- Progeny, Fruit Required, Total Fruit Collected

**Special Features:**
- **Fruit To Go** filter — Highlights crosses where the fruit collection target has not been met.

### 7.5 Seed

Manages seed processing, including acid treatment and sowing.

**Key Columns:**
- Progeny, Seed Weight Required, Seed Weight Inventory
- Seed Ready for Acid/GA treatment status
- Seed Weight to Sow, Seed Weight to Bank (storage)
- Acid/GA treatment start dates and deadlines
- Sow Start date

**Special Features:**
- **Treatment Tracking** — Automatically flags seeds that are ready for acid or GA treatment based on collection percentages and deadline dates.
- **Calculations Panel** — An information panel explaining the logic behind seed sowing and banking calculations.

### 7.6 Transplant

Tracks the transplanting of germinated seedlings into trays.

**Key Columns:**
- Progeny, Transplants Required, Plants Transplanted
- Transplant Instructions (e.g., Al Azar, Spineless, Spiny)
- Destination 1 & 2 quantities
- Transplant Adjustments (editable for Breeders)

**Special Features:**
- **Adjustment Inputs** — Breeders can modify the D1/D2 transplant adjustments to change the number of plants moved.

### 7.7 Screening (by Progeny)

Shows genotype screening status summarized by cross/progeny.

**Key Columns:**
- Progeny, Markers assigned, Samples Required, Samples Collected
- Keep Requests vs. Keep Actuals
- Sort Groups (1–5) for organizing screening results

### 7.8 Screening (by Plate)

Shows genotype screening status organized by physical lab plates.

**Key Columns:**
- Plate Index, Lab, Marker
- Samples Required, Samples Collected
- Screening completion status

### 7.9 Sort Group Allocation

Used **between screening and shipping** to decide how each progeny's screened-and-kept Sort Group counts (1–5) are split between its two destinations (D1 and D2). One sort group might prefer Destination 1, another Destination 2, or be split evenly — you set that here and save it.

**Filter Gate:** This screen only loads after you've set all three global filters (top bar): **Berry**, **Pollination Team**, and **Pollination Year**. Until then, an amber notice tells you which filters are still missing.

**Eligibility:** Only progenies that meet ALL of these are listed:

- Active cross
- Both D1 *and* D2 destinations are set (one-destination crosses don't need allocation)
- At least one Sort Group (1–5) has a count greater than zero

**What You See:**

- **Gallery Totals & Priorities** — a single 5-row table at the top of the page summing each Sort Group across every eligible progeny. Each row has a **Priority dropdown** that drives how the split happens for that Sort Group across all progenies:
  - **Equal split** — divide 50/50 (odd unit goes to D2 first), capped by each side's ship request.
  - **D1 priority** — fill Destination 1 up to its remaining ship request, overflow goes to D2.
  - **D2 priority** — mirror of D1.
- **Progeny cards** — one card per eligible progeny in a responsive grid. Each card shows the source Sort Group totals, the split your priorities produce for D1 and D2, and a comparison of planned vs. requested ship counts (green = on target, amber = over, red = under).

**How the Algorithm Works:** Priorities are applied in order from Sort Group 1 to Sort Group 5, tracking each side's remaining ship-request capacity. Once a side hits its capacity for a higher sort group, overflow lands on the other side for that group and *subsequent* groups. The total across D1 + D2 always equals the source Sort Group total for that progeny — nothing is lost, only redistributed.

**Save:** The **Save All** button (top right) writes every progeny's split in one transaction. The save is rejected if any (progeny, sort group) has D1 + D2 exceeding the source total — the error message lists the offending rows. Permission required: **Breeder (level 2) or higher**.

**Optional Local Filter:** A **Program** dropdown lets you narrow the gallery to one breeding program at a time. The Reset button clears local filters and resets priorities to Equal.

---

### 7.10 Ship

The final stage — preparing and tracking seedling shipments to their destinations.

**Key Columns:**
- Progeny, Destination, Total Ship Plan, Ship Actual Total
- First Tray/Box, Last Tray/Box, Rack/Pallet information
- Extras Not Shipped (seedlings exceeding requirements)

---

## 8. Reference Tables

Reference tables contain the configuration data that drives calculations and options throughout the app. These are typically managed by administrators.

### 8.1 Labs

Manage the external testing laboratories used for genotype screening.

| Field | Description |
|-------|-------------|
| Lab Name | Name of the testing lab |
| Plate Sample Number | Standard capacity of a plate at this lab |
| Active | Whether the lab is currently available for selection |

### 8.2 Teams

Manage the breeding teams within the organization.

| Field | Description |
|-------|-------------|
| Team Name | Name of the team (e.g., U.S., Guzman) |
| Active | Whether the team is currently active |

### 8.3 Trays

Define the standard tray sizes used in the greenhouse.

| Field | Description |
|-------|-------------|
| Tray Size | Number of cells in the tray |
| M² Per Tray | Surface area of the tray |

### 8.4 Ratios

Manage the success percentages and yield factors used in propagation calculations. These ratios drive the automatic calculations throughout the app.

| Field | Description |
|-------|-------------|
| Seedling Transplant Success % | Expected survival rate during transplanting |
| Average Seed Germination % | Expected seed germination rate |
| Pollination Success % | Expected rate of successful pollinations |
| Seeds Per Gram | Yield factor for seed weight calculations |
| Grams of Seed Per Fruit | Yield factor for fruit-to-seed conversion |
| Standard Deviations | Statistical margins for germination, pollination, and flower collection |
| Team / Berry / Program | Which combination these ratios apply to |

### 8.5 Deadlines

Configure the operational schedule for each stage of the breeding lifecycle.

**Milestones Covered:**
- Crossing Files, Pollination, Fruit Collection, Seed Acid Treatment, Seed Sowing, Transplanting, Marker Screening

Each milestone has a **Start Week** and a **Deadline Week** (relative to a target date). Deadlines can be set per Berry Type, Team, Destination, and Program combination.

These deadlines drive the notification system that alerts team members when action items are approaching.

### 8.6 Employees

Manage user accounts and access permissions.

| Field | Description |
|-------|-------------|
| Employee Name | Full name displayed in the system |
| Employee Number | 4-digit code used as the login PIN |
| Team | Assigned breeding team |
| Email | Used for automated notifications |
| User Level | Permission level (see [Section 10](#10-user-roles--permissions)) |
| Active | Whether the account is enabled |

### 8.7 Marker List

Manage the catalog of genetic markers (traits) available for screening.

| Field | Description |
|-------|-------------|
| Trait / Marker Name | Name of the genetic marker |
| Berry | Which berry type this marker applies to |
| Preferred Lab | Default lab for processing |
| Aliases | Alternative names (Driscoll's or Corteva names) |
| Lab Status | Processing status at each lab (e.g., Corteva, LGC) |

### 8.8 Marker Allocations / Budget

Track the budget and sample limits for genotyping activities.

| Field | Description |
|-------|-------------|
| Sample Allocation Total | Maximum number of samples allowed |
| Cost Allocation Total | Budget amount for genotyping |
| Pollination Year | Which year the allocation applies to |
| Berry / Program / Lab / Team | Specific allocation scope |

### 8.9 Marker Prices

Manage the unit costs for genetic testing services.

| Field | Description |
|-------|-------------|
| Sample Price | Cost per sample |
| Year | Pricing year |
| Berry | Berry type for pricing |
| Genotyping Screen | Type of screening |
| Lab | Lab performing the work |

---

## 9. Language Support

The app supports four languages:

| Language | Code |
|----------|------|
| English | en |
| Spanish | es |
| Portuguese | pt |
| Arabic | ar (right-to-left) |

To change the language, use the language selector in the app interface. The entire interface — including labels, buttons, messages, and tooltips — will update to your selected language. Arabic is displayed in right-to-left layout.

---

## 10. User Roles & Permissions

Access to features is controlled by your assigned User Level:

| Level | Role | What You Can Do |
|-------|------|-----------------|
| **1** | User | View all data across the app. No editing capabilities. |
| **2** | Breeder | Everything a User can do, plus: add/edit crosses, inline edit shipping adjustments, comments, and discard percentages, and save Sort Group Allocations. |
| **3** | Admin | Everything a Breeder can do, plus: manage employees, toggle lifecycle stage completion, and access administrative settings. |
| **4** | Admin3 | Everything an Admin can do, plus: edit marker data and configurations. |
| **5** | Molecular | Full access to all features, including molecular data management and marker editing. |

Your User Level is assigned by an administrator in the Employees reference table.

---

## 11. Tips & Shortcuts

- **Inline Editing:** On the Crossing Lists, click directly into editable cells (highlighted on hover) to make quick changes. Remember to click **Save** to submit your batch of changes.
- **Batch Save:** When editing multiple rows, all changes are saved together when you click Save — you don't need to save each row individually.
- **Sticky Headers:** Table headers stay visible as you scroll down through long lists.
- **Color Coding:** Pay attention to background colors in the Crossing Lists:
  - **Green** on "Est Ship # (from Seed)" means you're meeting the ship requirement.
  - **Red** on "Est Ship # (from Seed)" means you're falling short.
  - **Amber** on adjustment columns indicates an adjustment has been entered.
  - **Red row** in Parent Inventory means insufficient parents for requirements.
- **Copy as New:** Use the "Copy as New" action on any cross to quickly create a similar cross — just give it a new Progeny name.
- **Pollen/Fruit To Go:** Use the "To Go" filters on the Pollen and Fruit pages to focus on items that still need attention.
- **Label Export:** On the Pollination page, use the export feature to generate CSV files for printing field labels.
- **Reset Filters:** Every gallery page has a Reset button to clear all filters and return to the default view.

---

*This manual covers Seedling Desktop as of May 2026. For questions or access issues, contact your system administrator.*
