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
import { Plus, ArrowRight, Pencil, Trash2, RotateCcw, Copy } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { MaseExportButton } from '@/components/ui/MaseExportButton';
import { PropCalcsPanel } from '@/components/ui/PropCalcsPanel';
import { useDebounce } from '@/hooks/use-debounce';

// Effective per-destination ship quantity = base + ship_adj + trans_adj*(1-discard).
// Mirrors the per-half term in the SQL TOTAL_SEEDLING_SHIP_REQUEST_Calc so the
// "D1 / D2 Ship Req" columns reflect ship and transplant adjustments live.
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

export default function CrossListShort() {
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
  const [fumigated, setFumigated] = useState<boolean | undefined>();
  const [resetPageSignal, setResetPageSignal] = useState(0);

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
        // Optimistic cache update: patch the saved fields directly into every
        // cached '/api/crosses' query so the table re-renders with new values
        // immediately, no waiting on a refetch round-trip.
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
        // Background refresh to pick up any server-derived changes (e.g. modified date).
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
    {
      key: 'destination1', header: 'Destination 1', width: 'min-w-44',
      ...(isBreeder ? { editable: { type: 'dropdown' as const, options: locationOptions } } : {}),
    },
    { key: 'd1SeedlingShipRequest', header: 'D1 Ship Req', isNumeric: true, render: (r) => formatNumber(effectiveShipQty(r.d1SeedlingShipRequest, r.breederRequestedShipDest1Adjustments, (r as any).d1TransplantAdjustment, r.expectedDiscardPercentage)) },
    {
      key: 'breederRequestedShipDest1Adjustments', header: 'D1 Adj +/-', isNumeric: true,
      ...(isBreeder ? { editable: { type: 'number' as const } } : {}),
      cellClassName: (r) => r.breederRequestedShipDest1Adjustments ? 'bg-amber-50' : '',
    },
    {
      key: 'destination2', header: 'Destination 2', width: 'min-w-44',
      ...(isBreeder ? { editable: { type: 'dropdown' as const, options: locationOptions } } : {}),
    },
    { key: 'd2SeedlingShipRequest', header: 'D2 Ship Req', isNumeric: true, render: (r) => formatNumber(effectiveShipQty(r.d2SeedlingShipRequest, r.breederRequestedShipDest2Adjustments, (r as any).d2TransplantAdjustment, r.expectedDiscardPercentage)) },
    {
      key: 'breederRequestedShipDest2Adjustments', header: 'D2 Adj +/-', isNumeric: true,
      ...(isBreeder ? { editable: { type: 'number' as const } } : {}),
      cellClassName: (r) => r.breederRequestedShipDest2Adjustments ? 'bg-amber-50' : '',
    },
    { key: 'totalSeedlingShipRequestCalc', header: 'Total Ship Req', isNumeric: true, render: (r) => formatNumber(r.totalSeedlingShipRequestCalc) },
    { key: 'estimatedPlantsToShip', header: 'Est Plants Ship', isNumeric: true, render: (r) => formatNumber(r.estimatedPlantsToShip) },
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
    { key: 'plantNumTransplanted', header: 'Transplants Done', isNumeric: true, render: (r) => formatNumber(r.plantNumTransplanted) },
    { key: 'transplantsRequired', header: 'Transplants Req', isNumeric: true, render: (r) => formatNumber(r.transplantsRequired) },
    { key: 'extraTransplants', header: 'Extra Trays Avail', isNumeric: true, render: (r) => formatNumber(r.extraTransplants) },
    {
      key: 'spinelessDiscardPercentage', header: 'Spiny Discard %', isNumeric: true,
      ...(isBreeder ? { editable: { type: 'number' as const, min: 0, max: 99, displayMultiplier: 100 } } : {}),
      render: (r, v) => formatPercent(v !== undefined ? v : r.spinelessDiscardPercentage),
      totalsRender: (v) => formatPercent(v),
    },
    { key: 'totalMarker', header: 'All Markers', isNumeric: true, render: (r) => formatNumber(r.totalMarker) },
    { key: 'totalSeedWeightSown', header: 'Seed Sown (G)', isNumeric: true, render: (r) => formatNumber(r.totalSeedWeightSown, 2) },
    { key: 'seedWeightRequired', header: 'Seed Required (G)', isNumeric: true, render: (r) => formatNumber(r.seedWeightRequired, 2) },
    { key: 'seedWeightInventory', header: 'Seed Inventory (G)', isNumeric: true, render: (r) => formatNumber(r.seedWeightInventory, 2) },
    { key: 'flowersToPollinateRequired', header: 'Flowers Req', isNumeric: true, render: (r) => formatNumber(r.flowersToPollinateRequired) },
    { key: 'successfulPollinations', header: 'Successful Polls', isNumeric: true, render: (r) => formatNumber(r.successfulPollinations) },
    { key: 'p1TotalParents', header: 'P1 Parents', isNumeric: true, render: (r) => formatNumber(r.p1TotalParents) },
    { key: 'p1TotalParentsRequired', header: 'P1 Req', isNumeric: true, render: (r) => formatNumber(r.p1TotalParentsRequired, 2) },
    { key: 'p2TotalParents', header: 'P2 Parents', isNumeric: true, render: (r) => formatNumber(r.p2TotalParents) },
    { key: 'p2TotalParentsRequired', header: 'P2 Req', isNumeric: true, render: (r) => formatNumber(r.p2TotalParentsRequired, 2) },
    { key: 'd1FieldPlantDate', header: 'D1 Plant Date', render: (r) => r.d1FieldPlantDate ? String(r.d1FieldPlantDate).slice(0, 10) : '' },
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
      plantNumTransplanted: dataRows.reduce((s: number, r: Cross) => s + (r.plantNumTransplanted ?? 0), 0),
      transplantsRequired: t?.transplantsRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.transplantsRequired ?? 0), 0),
      spinelessDiscardPercentage: dataRows.length ? dataRows.reduce((s: number, r: Cross) => s + (r.spinelessDiscardPercentage ?? 0), 0) / dataRows.length : 0,
      extraTransplants: t?.extraTransplants ?? dataRows.reduce((s: number, r: Cross) => s + (r.extraTransplants ?? 0), 0),
      totalMarker: dataRows.reduce((s: number, r: Cross) => s + (r.totalMarker ?? 0), 0),
      totalSeedWeightSown: t?.seedWtSown ?? dataRows.reduce((s: number, r: Cross) => s + (r.totalSeedWeightSown ?? 0), 0),
      seedWeightRequired: t?.seedRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.seedWeightRequired ?? 0), 0),
      seedWeightInventory: t?.seedInventory ?? dataRows.reduce((s: number, r: Cross) => s + (r.seedWeightInventory ?? 0), 0),
      flowersToPollinateRequired: t?.flowersToPollinateRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.flowersToPollinateRequired ?? 0), 0),
      successfulPollinations: t?.successfulPollinations ?? dataRows.reduce((s: number, r: Cross) => s + (r.successfulPollinations ?? 0), 0),
      p1TotalParents: t?.p1TotalParents ?? dataRows.reduce((s: number, r: Cross) => s + (r.p1TotalParents ?? 0), 0),
      p1TotalParentsRequired: t?.p1ParentsRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.p1TotalParentsRequired ?? 0), 0),
      p2TotalParents: t?.p2TotalParents ?? dataRows.reduce((s: number, r: Cross) => s + (r.p2TotalParents ?? 0), 0),
      p2TotalParentsRequired: t?.p2ParentsRequired ?? dataRows.reduce((s: number, r: Cross) => s + (r.p2TotalParentsRequired ?? 0), 0),
    } as Partial<Record<string, number>>;
  }, [totalsData, dataRows]);

  const actionBar = (
    <div className="flex items-center gap-2">
      {canEditCrosses && (
        <Button size="sm" onClick={() => navigate('/crosses/form')} className="gap-1.5 rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add Cross
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => navigate('/crosses/full')} className="gap-1.5 rounded-lg">
        <ArrowRight className="w-3.5 h-3.5" /> Full List
      </Button>
    </div>
  );

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('crosses.shortList')}</h1>
            <p className="text-muted-foreground mt-1">Condensed view of crosses and calculated propagation needs.</p>
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
            <input
              type="checkbox"
              checked={fumigated === true}
              onChange={e => setFumigated(e.target.checked ? true : undefined)}
              className="rounded"
            />
            Fumigated
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          title="Crosses"
          data={crossesData?.data || []}
          columns={columns}
          totals={crossesTotals}
          isLoading={isLoading}
          resetPageSignal={resetPageSignal}
          {...(isBreeder ? { onBatchSave: handleBatchSave, isSaving: batchUpdate.isPending } : {})}
          actionBar={actionBar}
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
