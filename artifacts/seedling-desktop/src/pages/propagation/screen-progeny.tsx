import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import {
  useListScreeningProgeny,
  useGetScreeningProgenyTotals,
  useListPrograms,
  ScreeningProgeny,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { RotateCcw } from 'lucide-react';

export default function ScreenByProgenyList() {
  const { t } = useTranslation();
  const { filters } = useFilters();

  const [progenySearch, setProgenySearch] = useState('');
  const [programIds, setProgramIds] = useState<number[]>([]);
  const [screeningOnly, setScreeningOnly] = useState(true);
  const [sortedOnly, setSortedOnly] = useState(false);
  const debouncedProgeny = useDebounce(progenySearch);

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    spCrosses: filters.spCrosses || undefined,
    progeny: debouncedProgeny || undefined,
    programId: programIds.length ? programIds.join(',') : undefined,
    screening: screeningOnly,
    sorted: sortedOnly ? true : undefined,
    page: 1,
    pageSize: 5000,
  } as any;

  const { data: progenyData, isLoading } = useListScreeningProgeny(queryParams);
  const { data: totalsData } = useGetScreeningProgenyTotals(queryParams);
  const { data: programs } = useListPrograms({ berryId: filters.berryId, active: true });

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setProgenySearch('');
    setProgramIds([]);
    setScreeningOnly(true);
    setSortedOnly(false);
      setResetPageSignal(s => s + 1);
  };

  const rows = useMemo(() => progenyData?.data || [], [progenyData]);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  };

  const columns: ColumnDef<ScreeningProgeny>[] = [
    { key: 'progeny', header: 'Progeny', sticky: true, width: 'w-32' },
    { key: 'd1Program', header: 'D1 Program', width: 'w-28' },
    { key: 'd2Program', header: 'D2 Program', width: 'w-28' },
    { key: 'labName', header: 'Lab Name', width: 'w-28' },
    { key: 'labBarcode', header: 'Lab Bar Code', width: 'w-32' },
    { key: 'startingPlateIndex', header: 'Starting Plate Index', isNumeric: true, width: 'w-24' },
    { key: 'endingPlateIndex', header: 'Ending Plate Index', isNumeric: true, width: 'w-24' },
    { key: 'createdBy', header: 'Created By', width: 'w-32' },
    {
      key: 'createdDate', header: 'Created Date', width: 'w-28',
      render: (r) => formatDate(r.createdDate),
    },
    { key: 'marker1', header: 'Marker 1', width: 'w-24' },
    { key: 'marker2', header: 'Marker 2', width: 'w-24' },
    { key: 'marker3', header: 'Marker 3', width: 'w-24' },
    { key: 'marker4', header: 'Marker 4', width: 'w-24' },
    { key: 'marker5', header: 'Marker 5', width: 'w-24' },
    {
      key: 'totalPlatesRequired', header: 'Total Plates Req', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.totalPlatesRequired),
    },
    {
      key: 'platesCollected', header: 'Plates Collected', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.platesCollected),
    },
    {
      key: 'sampleRequired', header: 'Samples Req', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.sampleRequired),
    },
    {
      key: 'samplesCollected', header: 'Samples Collected', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.samplesCollected),
    },
    {
      key: 'keepRequest', header: 'Keep Request', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.keepRequest),
    },
    {
      key: 'keepActual', header: 'Keep Actual', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.keepActual),
    },
    {
      key: 'totalDiscardsActual', header: 'Discards Actual', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.totalDiscardsActual),
    },
    {
      key: 'sorted', header: 'Sorted?', width: 'w-20',
      render: (r) => r.sorted ? 'Yes' : 'No',
    },
    {
      key: 'sortGroup1', header: 'Sort Group 1', isNumeric: true, width: 'w-20',
      render: (r) => formatNumber(r.sortGroup1),
    },
    {
      key: 'sortGroup2', header: 'Sort Group 2', isNumeric: true, width: 'w-20',
      render: (r) => formatNumber(r.sortGroup2),
    },
    {
      key: 'sortGroup3', header: 'Sort Group 3', isNumeric: true, width: 'w-20',
      render: (r) => formatNumber(r.sortGroup3),
    },
    {
      key: 'sortGroup4', header: 'Sort Group 4', isNumeric: true, width: 'w-20',
      render: (r) => formatNumber(r.sortGroup4),
    },
    {
      key: 'sortGroup5', header: 'Sort Group 5', isNumeric: true, width: 'w-20',
      render: (r) => formatNumber(r.sortGroup5),
    },
    { key: 'testingLab1', header: 'Testing Lab #1', width: 'w-24' },
    { key: 'testingLab2', header: 'Testing Lab #2', width: 'w-24' },
  ];

  const totals = totalsData
    ? {
        progeny: totalsData.rowCount ?? 0,
        totalPlatesRequired: rows.reduce((s, r) => s + (r.totalPlatesRequired ?? 0), 0),
        platesCollected: rows.reduce((s, r) => s + (r.platesCollected ?? 0), 0),
        sampleRequired: totalsData.sampleRequired,
        samplesCollected: totalsData.samplesCollected,
        keepRequest: totalsData.keepRequest,
        keepActual: totalsData.keepActual,
        totalDiscardsActual: totalsData.totalDiscardsActual,
        sortGroup1: totalsData.sortGroup1,
        sortGroup2: totalsData.sortGroup2,
        sortGroup3: totalsData.sortGroup3,
        sortGroup4: totalsData.sortGroup4,
        sortGroup5: totalsData.sortGroup5,
      }
    : undefined;

  const programOptions = useMemo(() => {
    return (programs || []).map((p: any) => ({ value: p.id as number, label: p.srcBreedingProgram as string }));
  }, [programs]);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('propagation.screenProgeny.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('propagation.screenProgeny.description')}</p>
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
            options={programOptions}
            placeholder="All Programs"
            className="w-52"
          />
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={screeningOnly}
              onChange={(e) => setScreeningOnly(e.target.checked)}
              className="rounded"
            />
            Screen = Yes
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={sortedOnly}
              onChange={(e) => setSortedOnly(e.target.checked)}
              className="rounded"
            />
            Sorted = Yes
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal}
          data={rows}
          columns={columns}
          title="Screen by Progeny"
          totals={totals}
        />
      </div>
    </Layout>
  );
}
