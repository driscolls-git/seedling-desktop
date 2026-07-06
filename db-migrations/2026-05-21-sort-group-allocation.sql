-- ==============================================================================
-- Migration: T_GHSortGroupAllocation
-- Date     : 2026-05-21
-- Purpose  : Persist per-destination (D1/D2) sort-group allocations entered on
--            the new "Sort Group Allocation" screen in Seedling Desktop.
--
-- Today vw_GH_Destination_Shipping shows Sort_Group_1..5 as counts aggregated
-- from T_GHMarkerDiscards keyed by ghsm_FK only — so D1 and D2 rows of any
-- progeny return the SAME numbers (the unsplit totals). There is no schema
-- support today for splitting those counts between the two destinations.
--
-- This migration adds a thin allocation table keyed by (ghsm_FK,
-- Destination_Type). The app reads/writes splits here; the existing view
-- continues to report the unsplit totals for any other consumer. No existing
-- table or view is modified.
--
-- Owner   : DBA team (per replit.md: "Schema is owned by the SQL Server DBAs;
--           the app does not push migrations").
-- Runtime : Single-statement DDL on a small dimension table. Negligible.
-- Rollback: DROP TABLE dbo.T_GHSortGroupAllocation; (see bottom).
-- ==============================================================================

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.T_GHSortGroupAllocation', 'U') IS NOT NULL
BEGIN
    PRINT 'dbo.T_GHSortGroupAllocation already exists — skipping.';
    RETURN;
END
GO

CREATE TABLE dbo.T_GHSortGroupAllocation (
    SortGroupAllocation_ID INT          IDENTITY(1,1) NOT NULL,
    ghsm_FK                INT          NOT NULL,
    Destination_Type       CHAR(2)      NOT NULL,
    Sort_Group_1           INT          NOT NULL CONSTRAINT DF_GHSortGroupAllocation_SG1 DEFAULT (0),
    Sort_Group_2           INT          NOT NULL CONSTRAINT DF_GHSortGroupAllocation_SG2 DEFAULT (0),
    Sort_Group_3           INT          NOT NULL CONSTRAINT DF_GHSortGroupAllocation_SG3 DEFAULT (0),
    Sort_Group_4           INT          NOT NULL CONSTRAINT DF_GHSortGroupAllocation_SG4 DEFAULT (0),
    Sort_Group_5           INT          NOT NULL CONSTRAINT DF_GHSortGroupAllocation_SG5 DEFAULT (0),
    Created_By             VARCHAR(100) NOT NULL,
    Created_DateTime       DATETIME     NOT NULL CONSTRAINT DF_GHSortGroupAllocation_Created DEFAULT (GETDATE()),
    Modified_By            VARCHAR(100) NULL,
    Modified_DateTime      DATETIME     NULL,

    CONSTRAINT PK_GHSortGroupAllocation
        PRIMARY KEY CLUSTERED (SortGroupAllocation_ID),

    -- One allocation row per (progeny, destination side).
    CONSTRAINT UQ_GHSortGroupAllocation_ProgenyDest
        UNIQUE (ghsm_FK, Destination_Type),

    -- Foreign key to the seedling master row this allocation belongs to.
    -- ON DELETE CASCADE so deleting a cross also removes its allocation;
    -- adjust if your house style is "soft-delete only".
    CONSTRAINT FK_GHSortGroupAllocation_GHSeedlingMaster
        FOREIGN KEY (ghsm_FK)
        REFERENCES dbo.M_GHSeedlingMaster (GHSeedlingMaster_ID)
        ON DELETE CASCADE,

    -- Only the two destinations the rest of the schema knows about.
    CONSTRAINT CK_GHSortGroupAllocation_Destination_Type
        CHECK (Destination_Type IN ('D1', 'D2')),

    -- Sort-group counts can't go negative.
    CONSTRAINT CK_GHSortGroupAllocation_NonNegative
        CHECK (Sort_Group_1 >= 0 AND Sort_Group_2 >= 0
           AND Sort_Group_3 >= 0 AND Sort_Group_4 >= 0
           AND Sort_Group_5 >= 0)
);
GO

-- Secondary index for the lookup pattern the app uses on every page load.
CREATE NONCLUSTERED INDEX IX_GHSortGroupAllocation_ghsm_FK
    ON dbo.T_GHSortGroupAllocation (ghsm_FK)
    INCLUDE (Destination_Type, Sort_Group_1, Sort_Group_2, Sort_Group_3, Sort_Group_4, Sort_Group_5);
GO

-- Grant the application user the privileges it needs.
GRANT SELECT, INSERT, UPDATE, DELETE
    ON dbo.T_GHSortGroupAllocation
    TO WebAppUser;
GO

PRINT 'Created dbo.T_GHSortGroupAllocation with index and grants.';

-- ==============================================================================
-- ROLLBACK (run separately if needed):
--
--   DROP TABLE dbo.T_GHSortGroupAllocation;
--
-- No data loss for the existing system because nothing else references this
-- table yet.
-- ==============================================================================
