import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import {
  useListFruit, useGetFruitTotals,
  useListPrograms, FruitRow,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { RotateCcw } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

export default function FruitList() {
  const { t } = useTranslation();
  const { filters } = useFilters();

  const [progenySearch, setProgenySearch] = useState('');
  const [parentSearch, setParentSearch] = useState('');
  const [programIds, setProgramIds] = useState<number[]>([]);
  const [fruitToGoOnly, setFruitToGoOnly] = useState(false);
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
    fruitToGo: fruitToGoOnly || undefined,
    page: 1,
    pageSize: 5000,
    sortBy: 'progeny' as string,
  } as any;

  const { data: fruitResponse, isLoading } = useListFruit(queryParams);
  const { data: totalsData } = useGetFruitTotals(queryParams);
  const { data: programs } = useListPrograms({ berryId: filters.berryId, active: true });

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setProgenySearch('');
    setParentSearch('');
    setProgramIds([]);
    setFruitToGoOnly(false);
      setResetPageSignal(s => s + 1);
  };

  const fruitData = fruitResponse?.data || [];

  const columns: ColumnDef<FruitRow>[] = [
    { key: 'progeny', header: 'Progeny', sticky: true, width: 'w-36' },
    { key: 'parent1', header: 'Parent 1', width: 'w-32' },
    { key: 'parent2', header: 'Parent 2', width: 'w-32' },
    { key: 'd1Program', header: 'Dest 1 Program', width: 'w-40' },
    {
      key: 'reciprocalDone', header: 'Reciprocal Done', width: 'w-28',
      render: (r: FruitRow) => r.reciprocalDone ? 'Yes' : 'No',
    },
    {
      key: 'fruitRequired', header: 'Fruit Required', isNumeric: true, width: 'w-28',
      render: (r: FruitRow) => formatNumber(r.fruitRequired),
    },
    {
      key: 'totalFruitCollected', header: 'Fruit Collected', isNumeric: true, width: 'w-28',
      render: (r: FruitRow) => formatNumber(r.totalFruitCollected),
    },
    {
      key: 'fruitToGo', header: 'Fruit To Go', isNumeric: true, width: 'w-28',
      cellClassName: (r: FruitRow) => (r.fruitToGo ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 font-semibold' : '',
      render: (r: FruitRow) => formatNumber(r.fruitToGo),
    },
  ];

  const fruitTotals = totalsData ? {
    reciprocalDone: totalsData.reciprocalDone,
    fruitRequired: totalsData.fruitRequired,
    totalFruitCollected: totalsData.totalFruitCollected,
    fruitToGo: totalsData.fruitToGo,
  } : undefined;

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('propagation.fruit.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('propagation.fruit.description')}</p>
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
              checked={fruitToGoOnly}
              onChange={e => setFruitToGoOnly(e.target.checked)}
              className="rounded"
            />
            Fruit To Go &gt; 0
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal}
          title="Fruit"
          data={fruitData}
          columns={columns}
          totals={fruitTotals as Partial<Record<string, number>> | undefined}
          isLoading={isLoading}
        />
      </div>
    </Layout>
  );
}
