import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { InactivateDialog } from '@/components/ui/InactivateDialog';
import { useFilters } from '@/contexts/FilterContext';
import {
  useListCrosses, useGetCrossesTotals, useBatchUpdateCrosses,
  useDeleteCross, useListLocations, useListPrograms,
  Cross,
} from '@workspace/api-client-react';
import { formatNumber, formatPercent } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Pencil, Trash2, RotateCcw, Copy } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { MaseExportButton } from '@/components/ui/MaseExportButton';
import { PropCalcsPanel } from '@/components/ui/PropCalcsPanel';
import { useDebounce } from '@/hooks/use-debounce';

// Effective per-destination ship quantity, mirroring the per-half terms in the
// SQL TOTAL_SEEDLING_SHIP_REQUEST_Calc computed column:
//   base + ship_adjustment + transplant_adjustment * (1 - discard%)
// We render this in the "D1 / D2 Ship Req" columns so users see their ship +
// transplant adjustments take effect immediately on save.
function effectiveShipQty(
  base: number | null | undefined,
  shipAdj: number | null | undefined,
  transAdj: number | null | undefined,
  discardPct: number | null | undefined,
): number | null {
  if (base == null && shipAdj == null && transAdj == null) return null;
  const b = base ?? 0;
  const sa = shipAdj ?? 0;
  const ta = transAdj ?? 0;
  const d = discardPct ?? 0;
  return b + sa + ta * (1 - d);
}

export default function CrossListFull() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { isBreeder, canEditCrosses, user } = useAuth();
  const canInactivate = user?.userLevelFk === 2;
  const { toast } = useToast();

  const [progenySearch, setProgenySearch] = useState('');
  const [programIds, setProgramIds] = useState<number[]>([]);
  const [destinationIds, setDestinationIds] = useState<number[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [resetPageSignal, setResetPageSignal] = useState(0);
  const [fumigated, setFumigated] = useState<boolean | undefined>();
  const [inactivateTarget, setInactivateTarget] = useState<Cross | null>(null);
  const debouncedProgeny = useDebounce(progenySearch);

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    spCrosses: filters.spCrosses,
    progeny: debouncedProgeny || undefined,
    programId: programIds.length ? programIds.join(',') : undefined,
    destinationId: destinationIds.length ? destinationIds.join(',') : undefined,
    active: activeOnly,
    fumigated,
    page: 1,
    pageSize: 5000,
    // Full list shows individual marker_1..6, P1/P2 inventory L1-L4, and
    // flowers-collected columns; the lite default omits them for speed.
    detail: 'full',
  } as any;

  const { data: crossesData, isLoading } = useListCrosses(queryParams);
  const { data: totalsData } = useGetCrossesTotals(queryParams);
  const { data: locations } = useListLocations({ active: true });
  const { data: programs } = useListPrograms({ berryId: filters.berryId, active: true });

  const batchUpdate = useBatchUpdateCrosses();
  const deleteCross = useDeleteCross();

  const locationOptions = useMemo(() =>
    (locations || []).map(l => ({ value: l.locationName, label: l.locationName })),
    [locations]
  );

  const handleBatchSave = (updates: { id: number; [key: string]: any }[], clearEdits: () => void) => {
    batchUpdate.mutate({ data: { updates } }, {
      onSuccess: () => {
        // Optimistic cache update — instantly reflects edits without waiting on refetch.
        const editsById = new Map(updates.map(u => [u.id, u]));
        queryClient.setQueriesData<any>({ queryKey: ['/api/crosses'] }, (old: any) => {
          if (!old?.data) return old;
          return {
            ...old,
            data: old.data.map((row: any) => {
              const e = editsById.get(row.id);
              if (!e) return row;
              const { id, ...changes } = e;
              return { ...row, ...changes };
            }),
          };
        });
        clearEdits();
        toast({ title: 'Saved', description: 'Changes saved successfully.' });
        queryClient.invalidateQueries({ queryKey: ['/api/crosses'] });
      },
      onError: () => {
        toast({ title: 'Error', description: 'Failed to save changes.', variant: 'destructive' });
      },
    });
  };

  const handleInactivate = (breederComment: string, ghComment: string) => {
    if (!inactivateTarget) return;
    const updates: any[] = [];
    if (breederComment || ghComment) {
      updates.push({
        id: inactivateTarget.id,
        ...(breederComment ? { breederComments: breederComment } : {}),
        ...(ghComment ? { ghTeamComments: ghComment } : {}),
      });
    }
    const doDelete = () => {
      deleteCross.mutate({ id: inactivateTarget.id }, {
        onSuccess: () => {
          setInactivateTarget(null);
          queryClient.invalidateQueries({ queryKey: ['/api/crosses'] });
          toast({ title: 'Inactivated', description: 'Cross inactivated successfully.' });
        },
        onError: () => {
          toast({ title: 'Error', description: 'Failed to inactivate cross.', variant: 'destructive' });
        },
      });
    };
    if (updates.length > 0) {
      batchUpdate.mutate({ data: { updates } }, {
        onSuccess: doDelete,
        onError: () => {
          toast({ title: 'Error', description: 'Failed to save inactivation comments.', variant: 'destructive' });
        },
      });
    } else {
      doDelete();
    }
  };

  const resetFilters = () => {
    setProgenySearch('');
    setProgramIds([]);
    setDestinationIds([]);
    setActiveOnly(true);
    setFumigated(undefined);
    setResetPageSignal(s => s + 1);
  };

  const flagRed = (flag?: boolean) => flag ? 'bg-red-50 text-red-700' : '';

  const columns: ColumnDef<Cross>[] = [
    ...(canEditCrosses ? [{
      key: '_actions', header: 'Actions', width: 'w-24',
      render: (r: Cross) => (
        <div className="flex items-center gap-1">
          <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate(`/crosses/form?id=${r.id}`); }}
            className="p-1 rounded hover:bg-primary/10 text-primary" title={t('common.edit')}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate(`/crosses/form?copy=${r.id}`); }}
            className="p-1 rounded hover:bg-primary/10 text-primary" title="Copy as New">
            <Copy className="w-3.5 h-3.5" />
          </button>
          {canInactivate && (
            <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); setInactivateTarget(r); }}
              className="p-1 rounded hover:bg-destructive/10 text-destructive" title="Inactivate">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ),
    } as ColumnDef<Cross>] : []),
    { key: 'progeny', header: 'Progeny', sticky: true, width: 'w-44' },
    { key: 'parent1', header: 'Parent 1', cellClassName: (r) => flagRed(r.p1FlagBit) },
    { key: 'parent2', header: 'Parent 2', cellClassName: (r) => flagRed(r.p2FlagBit) },
    { key: 'destination1', header: 'Destination 1', width: 'min-w-44', ...(isBreeder ? { editable: { type: 'dropdown' as const, options: locationOptions } } : {}) },
    { key: 'd1Program', header: 'D1 Program' },
    { key: 'd1SeedlingShipRequest', header: 'D1 Ship Req', isNumeric: true, render: (r) => formatNumber(effectiveShipQty(r.d1SeedlingShipRequest, r.breederRequestedShipDest1Adjustments, (r as any).d1TransplantAdjustment, r.expectedDiscardPercentage)) },
    {
      key: 'breederRequestedShipDest1Adjustments', header: 'D1 Adj +/-', isNumeric: true,
      ...(isBreeder ? { editable: { type: 'number' as const } } : {}),
      cellClassName: (r) => r.breederRequestedShipDest1Adjustments ? 'bg-amber-50' : '',
    },
    { key: 'destination2', header: 'Destination 2', width: 'min-w-44', ...(isBreeder ? { editable: { type: 'dropdown' as const, options: locationOptions } } : {}) },
    { key: 'd2Program', header: 'D2 Program' },
    { key: 'd2SeedlingShipRequest', header: 'D2 Ship Req', isNumeric: true, render: (r) => formatNumber(effectiveShipQty(r.d2SeedlingShipRequest, r.breederRequestedShipDest2Adjustments, (r as any).d2TransplantAdjustment, r.expectedDiscardPercentage)) },
    {
      key: 'breederRequestedShipDest2Adjustments', header: 'D2 Adj +/-', isNumeric: true,
      ...(isBreeder ? { editable: { type: 'number' as const } } : {}),
      cellClassName: (r) => r.breederRequestedShipDest2Adjustments ? 'bg-amber-50' : '',
    },
    { key: 'suggestedLowShipQtyAdj', header: 'Sug Low Ship Qty Adj', isNumeric: true, render: (r) => formatNumber(r.suggestedLowShipQtyAdj) },
    { key: 'suggestedHighShipQtyAdj', header: 'Sug High Ship Qty Adj', isNumeric: true, render: (r) => formatNumber(r.suggestedHighShipQtyAdj) },
    { key: 'totalSeedlingShipRequestCalc', header: 'Total Ship Req', isNumeric: true, render: (r) => formatNumber(r.totalSeedlingShipRequestCalc) },
    {
      key: 'estimatedPlantsToShip', header: 'Est Ship # (from Trans)', isNumeric: true,
      render: (r) => formatNumber(r.estimatedPlantsToShip),
      cellClassName: (r) => {
        const est = r.estimatedPlantsToShip;
        const req = r.totalSeedlingShipRequestCalc;
        if (est == null || req == null) return '';
        return est < req ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700';
      },
    },
    {
      key: 'seedWtToSeedlingShip', header: 'Est Ship # (from Seed)', isNumeric: true,
      render: (r) => formatNumber(r.seedWtToSeedlingShip),
      cellClassName: (r) => {
        const est = r.seedWtToSeedlingShip;
        const req = r.totalSeedlingShipRequestCalc;
        if (est == null || req == null) return '';
        return est < req ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700';
      },
    },
    {
      key: 'expectedDiscardPercentage', header: 'Exp Discard %', isNumeric: true,
      ...(isBreeder ? { editable: { type: 'number' as const, min: 0, max: 99, displayMultiplier: 100 } } : {}),
      render: (r, v) => formatPercent(v !== undefined ? v : r.expectedDiscardPercentage),
      totalsRender: (v) => formatPercent(v),
    },
    {
      key: 'spinelessDiscardPercentage', header: 'Spiny Discard %', isNumeric: true,
      ...(isBreeder ? { editable: { type: 'number' as const, min: 0, max: 99, displayMultiplier: 100 } } : {}),
      render: (r, v) => formatPercent(v !== undefined ? v : r.spinelessDiscardPercentage),
      totalsRender: (v) => formatPercent(v),
    },
    { key: 'transplantInstructions', header: 'Transplant Instructions' },
    { key: 'transplantsRequired', header: 'Transplants Req', isNumeric: true, render: (r) => formatNumber(r.transplantsRequired) },
    { key: 'plantNumTransplanted', header: 'Transplants Done', isNumeric: true, render: (r) => formatNumber(r.plantNumTransplanted) },
    { key: 'extraTransplants', header: 'Extra Trays Avail', isNumeric: true, render: (r) => formatNumber(r.extraTransplants) },
    { key: 'shipTotalActual', header: 'Plants Shipped', isNumeric: true, render: (r) => formatNumber(r.shipTotalActual) },
    { key: 'traySize', header: 'Tray Size', isNumeric: true },
    { key: 'traysRequestedCalc', header: 'Trays Req', isNumeric: true, render: (r) => formatNumber(r.traysRequestedCalc) },
    { key: 'screening', header: 'Screening', render: (r) => r.screening ? 'Yes' : 'No' },
    { key: 'sortByMarkerGroup', header: 'Sort by Marker Grp', render: (r) => r.sortByMarkerGroup ? 'Yes' : 'No' },
    { key: 'marker1', header: 'Marker 1' },
    { key: 'marker2', header: 'Marker 2' },
    { key: 'marker3', header: 'Marker 3' },
    { key: 'marker4', header: 'Marker 4' },
    { key: 'marker5', header: 'Marker 5' },
    { key: 'marker6', header: 'Marker 6' },
    { key: 'testingLab1', header: 'Lab 1' },
    { key: 'testingLab2', header: 'Lab 2' },
    { key: 'sowSeed', header: 'Sow Seed?', render: (r) => r.sowSeed ? 'Yes' : 'No' },
    { key: 'totalSeedWeightSown', header: 'Seed Sown (G)', isNumeric: true, render: (r) => formatNumber(r.totalSeedWeightSown, 2) },
    { key: 'seedWeightRequired', header: 'Seed Wt Req (G)', isNumeric: true, render: (r) => formatNumber(r.seedWeightRequired, 2) },
    {
      key: 'seedWeightInventory', header: 'Seed Wt Inv (G)', isNumeric: true,
      render: (r) => formatNumber(r.seedWeightInventory, 2),
      cellClassName: (r) => flagRed(r.seedWtFlagBit),
    },
    { key: 'fruitRequired', header: 'Fruit Req', isNumeric: true, render: (r) => formatNumber(r.fruitRequired) },
    { key: 'totalFruitCollected', header: 'Fruit Collected', isNumeric: true, render: (r) => formatNumber(r.totalFruitCollected) },
    { key: 'flowersToPollinateRequired', header: 'Flowers Req', isNumeric: true, render: (r) => formatNumber(r.flowersToPollinateRequired) },
    { key: 'successfulPollinations', header: 'Successful Polls', isNumeric: true, render: (r) => formatNumber(r.successfulPollinations) },
    { key: 'flowersRequiredForPollen', header: 'Flowers for Pollen', isNumeric: true, render: (r) => formatNumber(r.flowersRequiredForPollen) },
    { key: 'goodFlowersCollected', header: 'Good Flowers Collected', isNumeric: true, render: (r) => formatNumber(r.goodFlowersCollected) },
    { key: 'reciprocalDone', header: 'Reciprocal Done?', render: (r) => r.reciprocalDone ? 'Yes' : 'No' },
    { key: 'p1L1fc', header: 'P1 L1 FC' },
    { key: 'p1L1', header: 'P1 L1', isNumeric: true },
    { key: 'p1L2fc', header: 'P1 L2 FC' },
    { key: 'p1L2', header: 'P1 L2', isNumeric: true },
    { key: 'p1L3fc', header: 'P1 L3 FC' },
    { key: 'p1L3', header: 'P1 L3', isNumeric: true },
    { key: 'p1L4fc', header: 'P1 L4 FC' },
    { key: 'p1L4', header: 'P1 L4', isNumeric: true },
    { key: 'p1TotalParents', header: 'P1 Total', isNumeric: true, render: (r) => formatNumber(r.p1TotalParents) },
    { key: 'p1TotalParentsRequired', header: 'P1 Req', isNumeric: true, render: (r) => formatNumber(r.p1TotalParentsRequired, 2) },
    { key: 'p2L1fc', header: 'P2 L1 FC' },
    { key: 'p2L1', header: 'P2 L1', isNumeric: true },
    { key: 'p2L2fc', header: 'P2 L2 FC' },
    { key: 'p2L2', header: 'P2 L2', isNumeric: true },
    { key: 'p2L3fc', header: 'P2 L3 FC' },
    { key: 'p2L3', header: 'P2 L3', isNumeric: true },
    { key: 'p2L4fc', header: 'P2 L4 FC' },
    { key: 'p2L4', header: 'P2 L4', isNumeric: true },
    { key: 'p2TotalParents', header: 'P2 Total', isNumeric: true, render: (r) => formatNumber(r.p2TotalParents) },
    { key: 'p2TotalParentsRequired', header: 'P2 Req', isNumeric: true, render: (r) => formatNumber(r.p2TotalParentsRequired, 2) },
    { key: 'bulkParent3', header: 'Bulk Parent 3' },
    { key: 'd1FieldPlantDate', header: 'D1 Plant Date', render: (r) => r.d1FieldPlantDate ? String(r.d1FieldPlantDate).slice(0, 10) : '' },
    { key: 'd2FieldPlantDate', header: 'D2 Plant Date', render: (r) => r.d2FieldPlantDate ? String(r.d2FieldPlantDate).slice(0, 10) : '' },
    { key: 'requestedFieldPlantYear', header: 'Plant Year', isNumeric: true },
    { key: 'pollinationYear', header: 'Poll Year', isNumeric: true },
    { key: 'berry', header: 'Berry' },
    { key: 'teamName', header: 'Team' },
    {
      key: 'breederComments', header: 'Breeder Comments',
      ...(isBreeder ? { editable: { type: 'text' as const } } : {}), width: 'w-56',
    },
    {
      key: 'ghTeamComments', header: 'GH Team Comments',
      ...(isBreeder ? { editable: { type: 'text' as const } } : {}), width: 'w-56',
    },
    { key: 'crossDesignedBy', header: 'Cross Designed By' },
    { key: 'fumigated', header: 'Fumigated?', render: (r) => r.fumigated ? 'Yes' : 'No' },
    { key: 'spCrosses', header: 'SP Crosses?', render: (r) => r.spCrosses ? 'Yes' : 'No' },
    { key: 'active', header: 'Active?', render: (r) => r.active ? 'Yes' : 'No' },
    { key: 'id', header: 'ID', isNumeric: true },
  ];

  const dataRows = crossesData?.data || [];
  const crossesTotals = useMemo(() => {
    const t = totalsData as any;
    if (!t && !dataRows.length) return undefined;
    return {
      d1SeedlingShipRequest: t?.d1ShipRequest ?? dataRows.reduce((s: number, r: Cross) => s + (r.d1SeedlingShipRequest ?? 0), 0),
      breederRequestedShipDest1Adjustments: t?.d1ShipAdj ?? dataRows.reduce((s: number, r: Cross) => s + (r.breederRequestedShipDest1Adjustments ?? 0), 0),
      d2SeedlingShipRequest: t?.d2ShipRequest ?? dataRows.reduce((s: number, r: Cross) => s + (r.d2SeedlingShipRequest ?? 0), 0),
      breederRequestedShipDest2Adjustments: t?.d2ShipAdj ?? dataRows.reduce((s: number, r: Cross) => s + (r.breederRequestedShipDest2Adjustments ?? 0), 0),
      totalSeedlingShipRequestCalc: t?.totalShipRequest ?? dataRows.reduce((s: number, r: Cross) => s + (r.totalSeedlingShipRequestCalc ?? 0), 0),
      estimatedPlantsToShip: t?.estimatedPlantsToShip ?? dataRows.reduce((s: number, r: Cross) => s + (r.estimatedPlantsToShip ?? 0), 0),
      seedWtToSeedlingShip: t?.seedWtToSeedlingShip ?? dataRows.reduce((s: number, r: Cross) => s + (r.seedWtToSeedlingShip ?? 0), 0),
      expectedDiscardPercentage: dataRows.length ? dataRows.reduce((s: number, r: Cross) => s + (r.expectedDiscardPercentage ?? 0), 0) / dataRows.length : 0,
      spinelessDiscardPercentage: dataRows.length ? dataRows.reduce((s: number, r: Cross) => s + (r.spinelessDiscardPercentage ?? 0), 0) / dataRows.length : 0,
      transplantsRequired: t?.transplantsRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.transplantsRequired ?? 0), 0),
      plantNumTransplanted: dataRows.reduce((s: number, r: Cross) => s + (r.plantNumTransplanted ?? 0), 0),
      extraTransplants: t?.extraTransplants ?? dataRows.reduce((s: number, r: Cross) => s + (r.extraTransplants ?? 0), 0),
      shipTotalActual: dataRows.reduce((s: number, r: Cross) => s + (r.shipTotalActual ?? 0), 0),
      traysRequestedCalc: dataRows.reduce((s: number, r: Cross) => s + (r.traysRequestedCalc ?? 0), 0),
      totalSeedWeightSown: t?.seedWtSown ?? dataRows.reduce((s: number, r: Cross) => s + (r.totalSeedWeightSown ?? 0), 0),
      seedWeightRequired: t?.seedRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.seedWeightRequired ?? 0), 0),
      seedWeightInventory: t?.seedInventory ?? dataRows.reduce((s: number, r: Cross) => s + (r.seedWeightInventory ?? 0), 0),
      fruitRequired: t?.fruitRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.fruitRequired ?? 0), 0),
      totalFruitCollected: t?.totalFruitCollected ?? dataRows.reduce((s: number, r: Cross) => s + (r.totalFruitCollected ?? 0), 0),
      flowersToPollinateRequired: t?.flowersToPollinateRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.flowersToPollinateRequired ?? 0), 0),
      successfulPollinations: t?.successfulPollinations ?? dataRows.reduce((s: number, r: Cross) => s + (r.successfulPollinations ?? 0), 0),
      flowersRequiredForPollen: dataRows.reduce((s: number, r: Cross) => s + (r.flowersRequiredForPollen ?? 0), 0),
      // goodFlowersCollected total intentionally omitted — parent rows often
      // share collected flower counts, so summing across crosses double-counts.
      p1L1: dataRows.filter((r: Cross) => (r as any).p1L1 != null).length,
      p1L2: dataRows.filter((r: Cross) => (r as any).p1L2 != null).length,
      p1L3: dataRows.filter((r: Cross) => (r as any).p1L3 != null).length,
      p1L4: dataRows.filter((r: Cross) => (r as any).p1L4 != null).length,
      p1TotalParents: t?.p1TotalParents ?? dataRows.reduce((s: number, r: Cross) => s + (r.p1TotalParents ?? 0), 0),
      p1TotalParentsRequired: t?.p1ParentsRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.p1TotalParentsRequired ?? 0), 0),
      p2L1: dataRows.filter((r: Cross) => (r as any).p2L1 != null).length,
      p2L2: dataRows.filter((r: Cross) => (r as any).p2L2 != null).length,
      p2L3: dataRows.filter((r: Cross) => (r as any).p2L3 != null).length,
      p2L4: dataRows.filter((r: Cross) => (r as any).p2L4 != null).length,
      p2TotalParents: t?.p2TotalParents ?? dataRows.reduce((s: number, r: Cross) => s + (r.p2TotalParents ?? 0), 0),
      p2TotalParentsRequired: t?.p2ParentsRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.p2TotalParentsRequired ?? 0), 0),
    } as Partial<Record<string, number>>;
  }, [totalsData, dataRows]);

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('crosses.fullList')}</h1>
            <p className="text-muted-foreground mt-1">Complete view with all columns for detailed cross management.</p>
          </div>
          <div className="flex items-center gap-2">
            <MaseExportButton crosses={dataRows} berryId={filters.berryId} />
          </div>
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <Input
            placeholder={t('filters.searchProgeny')}
            value={progenySearch}
            onChange={(e) => setProgenySearch(e.target.value)}
            className="w-52"
          />
          <MultiSelect
            value={programIds}
            onChange={setProgramIds}
            options={(programs || []).map(p => ({ value: p.id, label: p.srcBreedingProgram }))}
            placeholder="All Programs"
            className="w-52"
          />
          <MultiSelect
            value={destinationIds}
            onChange={setDestinationIds}
            options={(locations || []).map(l => ({ value: l.id, label: l.locationName }))}
            placeholder="All Destinations"
            className="w-52"
          />
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="rounded" />
            Active
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={fumigated === true} onChange={e => setFumigated(e.target.checked ? true : undefined)} className="rounded" />
            Fumigated
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          title="Crosses — Full View"
          data={crossesData?.data || []}
          columns={columns}
          totals={crossesTotals}
          isLoading={isLoading}
          resetPageSignal={resetPageSignal}
          {...(isBreeder ? { onBatchSave: handleBatchSave, isSaving: batchUpdate.isPending } : {})}
        />

        <PropCalcsPanel />
      </div>

      <InactivateDialog
        open={!!inactivateTarget}
        progeny={inactivateTarget?.progeny || ''}
        onClose={() => setInactivateTarget(null)}
        onConfirm={handleInactivate}
        isLoading={deleteCross.isPending}
      />
    </Layout>
  );
}
