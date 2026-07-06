import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import {
  useListScreeningPlates,
  useGetScreeningPlateTotals,
  useListScreeningLabs,
  useListPrograms,
  ScreeningPlate,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { RotateCcw } from 'lucide-react';

export default function ScreenByPlateList() {
  const { t } = useTranslation();
  const { filters } = useFilters();

  const [progenySearch, setProgenySearch] = useState('');
  const [programIds, setProgramIds] = useState<number[]>([]);
  const [testingLab, setTestingLab] = useState('');
  const [plateIndex, setPlateIndex] = useState<number | undefined>();
  const [screeningOnly, setScreeningOnly] = useState(true);
  const [sortedOnly, setSortedOnly] = useState(false);
  const debouncedProgeny = useDebounce(progenySearch);
  const debouncedPlateIndex = useDebounce(plateIndex, 600);

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    progeny: debouncedProgeny || undefined,
    programId: programIds.length ? programIds.join(',') : undefined,
    testingLab: testingLab || undefined,
    plateIndex: debouncedPlateIndex,
    screening: screeningOnly,
    sorted: sortedOnly ? true : undefined,
    page: 1,
    pageSize: 5000,
  } as any;

  const { data: platesData, isLoading } = useListScreeningPlates(queryParams);
  const { data: totalsData } = useGetScreeningPlateTotals(queryParams);
  const { data: labsList } = useListScreeningLabs();
  const { data: programs } = useListPrograms({ berryId: filters.berryId, active: true });

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setProgenySearch('');
    setProgramIds([]);
    setTestingLab('');
    setPlateIndex(undefined);
    setScreeningOnly(true);
    setSortedOnly(false);
      setResetPageSignal(s => s + 1);
  };

  const rows = useMemo(() => platesData?.data || [], [platesData]);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  };

  const columns: ColumnDef<ScreeningPlate>[] = [
    { key: 'plateIndex', header: 'Plate Index #', sticky: true, width: 'w-24', isNumeric: true },
    { key: 'progeny', header: 'Progeny', width: 'w-28' },
    { key: 'testingLab', header: 'Testing Lab', width: 'w-24' },
    {
      key: 'samplesRequired', header: 'Samples Req', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.samplesRequired),
    },
    {
      key: 'samplesCollected', header: 'Samples Collected', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.samplesCollected),
    },
    {
      key: 'sampleCollectionDate', header: 'Collection Date', width: 'w-28',
      render: (r) => formatDate(r.sampleCollectionDate),
    },
    {
      key: 'totalKeepRequest', header: 'Keep Request', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.totalKeepRequest),
    },
    {
      key: 'totalKeepActual', header: 'Keep Actual', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.totalKeepActual),
    },
    {
      key: 'totalDiscardsActual', header: 'Discards Actual', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.totalDiscardsActual),
    },
    {
      key: 'discardDate', header: 'Discard Date', width: 'w-28',
      render: (r) => formatDate(r.discardDate),
    },
    {
      key: 'sorted', header: 'Sorted?', width: 'w-20',
      render: (r) => r.sorted ? 'Yes' : 'No',
    },
    {
      key: 'sortGroup1', header: 'Sort Group 1', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.sortGroup1),
    },
    {
      key: 'sortGroup2', header: 'Sort Group 2', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.sortGroup2),
    },
    {
      key: 'sortGroup3', header: 'Sort Group 3', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.sortGroup3),
    },
    {
      key: 'sortGroup4', header: 'Sort Group 4', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.sortGroup4),
    },
    {
      key: 'sortGroup5', header: 'Sort Group 5', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.sortGroup5),
    },
  ];

  const totals = totalsData
    ? {
        plateIndex: totalsData.rowCount ?? 0,
        samplesRequired: totalsData.samplesRequired,
        samplesCollected: totalsData.samplesCollected,
        totalKeepRequest: totalsData.totalKeepRequest,
        totalKeepActual: totalsData.totalKeepActual,
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
            <h1 className="text-3xl font-display font-bold text-foreground">{t('propagation.screenPlate.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('propagation.screenPlate.description')}</p>
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
          <select
            className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
            value={testingLab}
            onChange={(e) => setTestingLab(e.target.value)}
          >
            <option value="">All Labs</option>
            {(labsList || []).map((lab: string) => (
              <option key={lab} value={lab}>{lab}</option>
            ))}
          </select>
          <Input
            type="number"
            placeholder="Plate Index #"
            value={plateIndex ?? ''}
            onChange={(e) => setPlateIndex(e.target.value ? parseInt(e.target.value) : undefined)}
            className="w-32"
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
          title="Screen by Plate"
          totals={totals}
        />
      </div>
    </Layout>
  );
}
