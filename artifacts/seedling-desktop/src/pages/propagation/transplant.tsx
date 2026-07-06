import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  useListTransplant, useGetTransplantTotals,
  useListPrograms, useListLocations,
  useBatchUpdateTransplant,
  customFetch,
  TransplantRow,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { RotateCcw, Download, Loader2 } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export default function TransplantList() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const { isBreeder } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [progenySearch, setProgenySearch] = useState('');
  const [programIds, setProgramIds] = useState<number[]>([]);
  const [destinationIds, setDestinationIds] = useState<number[]>([]);
  const [availablePlantsOnly, setAvailablePlantsOnly] = useState(false);
  const debouncedProgeny = useDebounce(progenySearch);

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    spCrosses: filters.spCrosses,
    progeny: debouncedProgeny || undefined,
    programId: programIds.length ? programIds.join(',') : undefined,
    destinationId: destinationIds.length ? destinationIds.join(',') : undefined,
    active: true,
    availablePlants: availablePlantsOnly || undefined,
    page: 1,
    pageSize: 5000,
    sortBy: 'progeny' as string,
  } as any;

  const { data: transplantData, isLoading } = useListTransplant(queryParams);
  const { data: totalsData } = useGetTransplantTotals(queryParams);
  const { data: programs } = useListPrograms({ berryId: filters.berryId, active: true });
  const { data: locations } = useListLocations({ active: true });
  const batchUpdate = useBatchUpdateTransplant();

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setProgenySearch('');
    setProgramIds([]);
    setDestinationIds([]);
    setAvailablePlantsOnly(false);
      setResetPageSignal(s => s + 1);
  };

  // "Export Tray Codes and Plate Indexes CSV" — pulls rows from
  // vw_GH_UniqueTrayCode filtered by the global + local filter set, then
  // wraps the columns with a leading empty "Top" column and trailing
  // "Qty Labels" (always 1) + empty "Color" column, per user spec.
  const [exportingTrayCodes, setExportingTrayCodes] = useState(false);
  const exportTrayCodesCSV = async () => {
    setExportingTrayCodes(true);
    try {
      const p = new URLSearchParams();
      if (filters.berryId != null)         p.set('berryId', String(filters.berryId));
      if (filters.teamId != null)          p.set('teamId', String(filters.teamId));
      if (filters.pollinationYear != null) p.set('pollinationYear', String(filters.pollinationYear));
      if (filters.spCrosses)               p.set('spCrosses', 'true');
      if (programIds.length)               p.set('programId', programIds.join(','));
      if (destinationIds.length)           p.set('destinationId', destinationIds.join(','));

      const body = await customFetch<{ data: Array<Record<string, unknown>> }>(
        `/api/transplant/tray-codes?${p.toString()}`,
        { method: 'GET' },
      );
      const rows = body.data || [];

      const headers = [
        'Top', 'Unique Tray Code', 'Plant Qty', 'Pollination Year', 'Plate Index',
        'Berry', 'Progeny', 'Program', 'Lab Name', 'Tray Qty', 'Screening',
        'SP Crosses', 'Team Name', 'Destination', 'Qty Labels', 'Color',
      ];
      const esc = (v: unknown): string => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csvRows = rows.map(r => [
        '', // Top (empty)
        esc(r.uniqueTrayCode),
        esc(r.plantQty),
        esc(r.pollinationYear),
        esc(r.plateIndex),
        esc(r.berry),
        esc(r.progeny),
        esc(r.program),
        esc(r.labName),
        esc(r.trayQty),
        esc(r.screening),
        esc(r.spCrosses),
        esc(r.teamName),
        esc(r.destination),
        1, // Qty Labels (always 1)
        '', // Color (empty)
      ].join(','));
      const csv = [headers.join(','), ...csvRows].join('\r\n');

      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tray-codes-and-plate-indexes.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: t('propagation.transplant.exportTrayCodesSuccess'),
        description: `${rows.length} rows exported.`,
      });
    } catch (err) {
      toast({
        title: t('common.networkError'),
        description: err instanceof Error ? err.message : 'Export failed',
        variant: 'destructive',
      });
    } finally {
      setExportingTrayCodes(false);
    }
  };

  const rows = useMemo(() => (transplantData?.data || []) as TransplantRow[], [transplantData]);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  };

  const formatPct = (v: number | null | undefined) => {
    if (v == null) return '';
    return `${Math.round(v * 100)}%`;
  };

  const handleBatchSave = (updates: { id: number; [key: string]: any }[], clearEdits: () => void) => {
    batchUpdate.mutate({ data: { updates } }, {
      onSuccess: () => {
        clearEdits();
        queryClient.invalidateQueries({ queryKey: ['/api/transplant'] });
        queryClient.invalidateQueries({ queryKey: ['/api/transplant/totals'] });
        toast({ title: 'Saved', description: 'Transplant adjustments saved successfully.' });
      },
      onError: () => {
        toast({ title: 'Error', description: 'Failed to save transplant adjustments.', variant: 'destructive' });
      },
    });
  };

  const columns: ColumnDef<TransplantRow>[] = [
    { key: 'progeny', header: 'Progeny', sticky: true, width: 'w-32' },
    { key: 'parent1', header: 'Parent 1', width: 'w-28' },
    { key: 'parent2', header: 'Parent 2', width: 'w-28' },
    { key: 'd1Program', header: 'D1 Program', width: 'w-36' },
    {
      key: 'transplantsRequired', header: 'Transplants Req', isNumeric: true, width: 'w-28',
      render: (r: TransplantRow) => formatNumber(r.transplantsRequired),
    },
    {
      key: 'plantNumTransplanted', header: 'Plants Transplanted', isNumeric: true, width: 'w-28',
      cellClassName: (r: TransplantRow) => {
        const transplanted = r.plantNumTransplanted ?? 0;
        const required = r.transplantsRequired ?? 0;
        if (required === 0 && transplanted === 0) return '';
        return transplanted < required
          ? 'bg-red-100 text-red-800 font-bold'
          : 'bg-emerald-100 text-emerald-800 font-bold';
      },
      render: (r: TransplantRow) => formatNumber(r.plantNumTransplanted),
    },
    {
      key: 'extraTransplants', header: 'Extra Trays', isNumeric: true, width: 'w-28',
      cellClassName: (r: TransplantRow) =>
        (r.extraTransplants ?? 0) > 0 ? 'bg-emerald-100 text-emerald-800 font-semibold' : '',
      render: (r: TransplantRow) => formatNumber(r.extraTransplants),
    },
    {
      key: 'd1TransplantAdjustment', header: 'D1 Trans Adj', isNumeric: true, width: 'w-28',
      ...(isBreeder ? { editable: { type: 'number' as const } } : {}),
      render: (r: TransplantRow) => r.d1TransplantAdjustment != null ? formatNumber(r.d1TransplantAdjustment) : '',
    },
    {
      key: 'd2TransplantAdjustment', header: 'D2 Trans Adj', isNumeric: true, width: 'w-28',
      ...(isBreeder ? { editable: { type: 'number' as const } } : {}),
      render: (r: TransplantRow) => r.d2TransplantAdjustment != null ? formatNumber(r.d2TransplantAdjustment) : '',
    },
    { key: 'destination1', header: 'Destination 1', width: 'w-36' },
    { key: 'destination2', header: 'Destination 2', width: 'w-36' },
    { key: 'd2Program', header: 'D2 Program', width: 'w-36' },
    {
      key: 'totalSeedlingShipRequestCalc', header: 'Total Plants to Ship', isNumeric: true, width: 'w-24',
      render: (r: TransplantRow) => formatNumber(r.totalSeedlingShipRequestCalc),
    },
    {
      key: 'd1SeedlingShipRequest', header: 'D1 Ship Qty', isNumeric: true, width: 'w-20',
      render: (r: TransplantRow) => formatNumber(r.d1SeedlingShipRequest),
    },
    {
      key: 'd2SeedlingShipRequest', header: 'D2 Ship Qty', isNumeric: true, width: 'w-20',
      render: (r: TransplantRow) => formatNumber(r.d2SeedlingShipRequest),
    },
    {
      key: 'breederRequestedShipDest1Adjustments', header: 'D1 Ship Adj', isNumeric: true, width: 'w-24',
      render: (r: TransplantRow) => formatNumber(r.breederRequestedShipDest1Adjustments),
    },
    {
      key: 'breederRequestedShipDest2Adjustments', header: 'D2 Ship Adj', isNumeric: true, width: 'w-24',
      render: (r: TransplantRow) => formatNumber(r.breederRequestedShipDest2Adjustments),
    },
    {
      key: 'breederAdjustmentDate', header: 'Adjustment Date', width: 'w-36',
      render: (r: TransplantRow) => formatDate(r.breederAdjustmentDate),
    },
    {
      key: 'expectedDiscardPercentage', header: 'Exp Discard %', isNumeric: true, width: 'w-20',
      render: (r: TransplantRow) => formatPct(r.expectedDiscardPercentage),
      totalsRender: (v: number) => formatPct(v),
    },
    { key: 'transplantInstructions', header: 'Transplant Instructions', width: 'w-40' },
    {
      key: 'plantNumTransAlAzar', header: 'Plant Qty Al Azar', isNumeric: true, width: 'w-20',
      render: (r: TransplantRow) => formatNumber(r.plantNumTransAlAzar),
    },
    {
      key: 'plantNumTransSpineless', header: 'Plant Qty Spineless', isNumeric: true, width: 'w-20',
      render: (r: TransplantRow) => formatNumber(r.plantNumTransSpineless),
    },
    {
      key: 'plantNumTransSpiny', header: 'Plant Qty Spiny', isNumeric: true, width: 'w-20',
      render: (r: TransplantRow) => formatNumber(r.plantNumTransSpiny),
    },
    {
      key: 'id', header: 'ID', isNumeric: true, width: 'w-16',
    },
  ];

  const transplantTotals = useMemo(() => {
    if (!totalsData) return undefined;
    return totalsData as Partial<Record<string, number>>;
  }, [totalsData]);

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('propagation.transplant.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('propagation.transplant.description')}</p>
          </div>
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <Input
            placeholder={t('filters.searchProgeny')}
            value={progenySearch}
            onChange={(e) => setProgenySearch(e.target.value)}
            className="w-44"
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
            <input
              type="checkbox"
              checked={availablePlantsOnly}
              onChange={e => setAvailablePlantsOnly(e.target.checked)}
              className="rounded"
            />
            Available Plants &gt; 0
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportTrayCodesCSV}
            disabled={exportingTrayCodes}
            className="gap-2 rounded-lg ms-auto"
          >
            {exportingTrayCodes
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />}
            {t('propagation.transplant.exportTrayCodes')}
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal}
          title="Transplant"
          data={rows}
          columns={columns}
          totals={transplantTotals}
          isLoading={isLoading}
          {...(isBreeder ? { onBatchSave: handleBatchSave, isSaving: batchUpdate.isPending } : {})}
        />
      </div>
    </Layout>
  );
}
