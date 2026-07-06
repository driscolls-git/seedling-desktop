import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';

const apiBase: string = import.meta.env.VITE_API_BASE || "/api";
import {
  useListPollination, useGetPollinationTotals,
  useListPrograms, PollinationRow,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { RotateCcw, Download } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

export default function PollinationList() {
  const { t } = useTranslation();
  const { filters } = useFilters();

  const [progenySearch, setProgenySearch] = useState('');
  const [parentSearch, setParentSearch] = useState('');
  const [programIds, setProgramIds] = useState<number[]>([]);
  const [pollinationToGoOnly, setPollinationToGoOnly] = useState(false);
  const [emasculationToGoOnly, setEmasculationToGoOnly] = useState(false);
  const debouncedProgeny = useDebounce(progenySearch);
  const debouncedParent = useDebounce(parentSearch);

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    spCrosses: filters.spCrosses,
    progeny: debouncedProgeny || undefined,
    parent: debouncedParent || undefined,
    programId: programIds.length ? programIds.join(',') : undefined,
    active: true,
    pollinationToGo: pollinationToGoOnly || undefined,
    emasculationToGo: emasculationToGoOnly || undefined,
    page: 1,
    pageSize: 5000,
    sortBy: 'progeny' as string,
  } as any;

  const { data: pollinationData, isLoading } = useListPollination(queryParams);
  const { data: totalsData } = useGetPollinationTotals(queryParams);
  const { data: programs } = useListPrograms({ berryId: filters.berryId, active: true });

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setProgenySearch('');
    setParentSearch('');
    setProgramIds([]);
    setPollinationToGoOnly(false);
    setEmasculationToGoOnly(false);
      setResetPageSignal(s => s + 1);
  };

  const rows = useMemo(() => {
    return (pollinationData?.data || []) as PollinationRow[];
  }, [pollinationData]);

  const columns: ColumnDef<PollinationRow>[] = [
    { key: 'progeny', header: 'Progeny', sticky: true, width: 'w-32' },
    { key: 'parent1', header: 'Parent 1', width: 'w-28' },
    { key: 'parent2', header: 'Parent 2', width: 'w-28' },
    { key: 'bulkParent3', header: 'Bulk Parent 3', width: 'w-28' },
    { key: 'd1Program', header: 'Dest 1 Program', width: 'w-36' },
    {
      key: 'reciprocalDone', header: 'Reciprocal Done', width: 'w-28',
      render: (r: PollinationRow) => r.reciprocalDone ? 'Yes' : 'No',
    },
    {
      key: 'flowersRequiredForPollen', header: 'Pollen Req', isNumeric: true, width: 'w-24',
      render: (r: PollinationRow) => formatNumber(r.flowersRequiredForPollen),
    },
    {
      key: 'totalFlowersCollected', header: 'Flowers Collected', isNumeric: true, width: 'w-28',
      render: (r: PollinationRow) => formatNumber(r.totalFlowersCollected),
    },
    {
      key: 'goodFlowersCollected', header: 'Good Flowers', isNumeric: true, width: 'w-24',
      render: (r: PollinationRow) => formatNumber(r.goodFlowersCollected),
    },
    {
      key: 'flowersToPollinateRequired', header: 'Pollinate Req', isNumeric: true, width: 'w-24',
      render: (r: PollinationRow) => formatNumber(r.flowersToPollinateRequired),
    },
    {
      key: 'successfulPollinations', header: 'Pollinate Done', isNumeric: true, width: 'w-24',
      render: (r: PollinationRow) => formatNumber(r.successfulPollinations),
    },
    {
      key: 'pollinateToGo', header: 'Pollinate To Go', isNumeric: true, width: 'w-28',
      cellClassName: (r: PollinationRow) => (r.pollinateToGo ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 font-semibold' : '',
      render: (r: PollinationRow) => formatNumber(r.pollinateToGo),
    },
    {
      key: 'emasculationToGo', header: 'Emasculation To Go', isNumeric: true, width: 'w-28',
      cellClassName: (r: PollinationRow) => (r.emasculationToGo ?? 0) > 0 ? 'bg-amber-50 text-amber-700 font-semibold' : '',
      render: (r: PollinationRow) => formatNumber(r.emasculationToGo),
    },
  ];

  const pollinationTotals = useMemo(() => {
    if (!totalsData) return undefined;
    return totalsData as Partial<Record<string, number>>;
  }, [totalsData]);

  const [labelExporting, setLabelExporting] = useState(false);

  const handleExportLabelCSV = async () => {
    setLabelExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.berryId) params.set('berryId', String(filters.berryId));
      if (filters.teamId) params.set('teamId', String(filters.teamId));
      if (filters.pollinationYear) params.set('pollinationYear', String(filters.pollinationYear));
      if (filters.spCrosses) params.set('spCrosses', 'true');
      if (progenySearch) params.set('progeny', progenySearch);
      if (parentSearch) params.set('parent', parentSearch);
      if (programIds.length) params.set('programId', programIds.join(','));
      params.set('active', 'true');

      const token = localStorage.getItem('auth_token');
      const resp = await fetch(`${apiBase}/pollination/label-export?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error('Export failed');
      const data = await resp.json();

      const escCSV = (v: unknown) => {
        if (v == null || v === '') return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const headers = [
        'PROGENY', 'FLOWERS_TO_POLLINATE_REQUIRED', 'PARENT1',
        'P1L1FC', 'P1L1', 'P1L2FC', 'P1L2', 'P1L3FC', 'P1L3', 'P1L4FC', 'P1L4',
        'PARENT2',
        'P2L1FC', 'P2L1', 'P2L2FC', 'P2L2', 'P2L3FC', 'P2L3', 'P2L4FC', 'P2L4',
        'RECIPROCAL_DONE', 'NEW_LABELS',
      ];
      const csvRows = [headers.join(',')];
      for (const r of data) {
        csvRows.push([
          escCSV(r.progeny),
          r.flowersToPollinateRequired ?? '',
          escCSV(r.parent1),
          escCSV(r.p1L1fc), r.p1L1 ?? '', escCSV(r.p1L2fc), r.p1L2 ?? '',
          escCSV(r.p1L3fc), r.p1L3 ?? '', escCSV(r.p1L4fc), r.p1L4 ?? '',
          escCSV(r.parent2),
          escCSV(r.p2L1fc), r.p2L1 ?? '', escCSV(r.p2L2fc), r.p2L2 ?? '',
          escCSV(r.p2L3fc), r.p2L3 ?? '', escCSV(r.p2L4fc), r.p2L4 ?? '',
          r.reciprocalDone ? 'TRUE' : 'FALSE',
          r.newLabels ? 'TRUE' : 'FALSE',
        ].join(','));
      }
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      const ts = `${now.getFullYear()}_${String(now.getMonth()+1).padStart(2,'0')}_${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}_${String(now.getMinutes()).padStart(2,'0')}`;
      a.download = `GH_Label_Export__${ts}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Label export error:', err);
    } finally {
      setLabelExporting(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('propagation.pollination.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('propagation.pollination.description')}</p>
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
          <Input
            placeholder={t('filters.searchParent')}
            value={parentSearch}
            onChange={(e) => setParentSearch(e.target.value)}
            className="w-44"
          />
          <MultiSelect
            value={programIds}
            onChange={setProgramIds}
            options={(programs || []).map(p => ({ value: p.id, label: p.srcBreedingProgram }))}
            placeholder="All Programs"
            className="w-52"
          />
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={pollinationToGoOnly}
              onChange={e => setPollinationToGoOnly(e.target.checked)}
              className="rounded"
            />
            Pollination To Go &gt; 0
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={emasculationToGoOnly}
              onChange={e => setEmasculationToGoOnly(e.target.checked)}
              className="rounded"
            />
            Emasculation To Go &gt; 0
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal}
          title="Pollination"
          data={rows}
          columns={columns}
          totals={pollinationTotals}
          isLoading={isLoading}
          actionBar={
            <Button variant="outline" size="sm" onClick={handleExportLabelCSV} disabled={labelExporting} className="gap-1.5 rounded-lg">
              <Download className="w-3.5 h-3.5" /> {labelExporting ? 'Exporting...' : 'Export Label CSV'}
            </Button>
          }
        />
      </div>
    </Layout>
  );
}
