import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import { useListPollen, Pollen } from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RotateCcw, Columns } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

export default function PollenList() {
  const { t } = useTranslation();
  const { filters } = useFilters();

  const [parentSearch, setParentSearch] = useState('');
  const [pollenToGoOnly, setPollenToGoOnly] = useState(false);
  const [showL2L4, setShowL2L4] = useState(false);
  const debouncedParent = useDebounce(parentSearch);

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    spCrosses: filters.spCrosses,
    selection: debouncedParent || undefined,
    pollenToGo: pollenToGoOnly || undefined,
  };

  const { data: pollenData, isLoading } = useListPollen(queryParams);

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setParentSearch('');
    setPollenToGoOnly(false);
      setResetPageSignal(s => s + 1);
  };

  const rows = useMemo(() => pollenData || [], [pollenData]);

  const columns: ColumnDef<Pollen>[] = [
    { key: 'selection', header: 'Selection', sticky: true, width: 'w-32' },
    { key: 'l1fc', header: 'L1 FC', width: 'w-28' },
    { key: 'l1', header: 'L1', width: 'w-16' },
    { key: 'l2fc', header: 'L2 FC', width: 'w-28', hidden: !showL2L4 },
    { key: 'l2', header: 'L2', width: 'w-16', hidden: !showL2L4 },
    { key: 'l3fc', header: 'L3 FC', width: 'w-28', hidden: !showL2L4 },
    { key: 'l3', header: 'L3', width: 'w-16', hidden: !showL2L4 },
    { key: 'l4fc', header: 'L4 FC', width: 'w-28', hidden: !showL2L4 },
    { key: 'l4', header: 'L4', width: 'w-16', hidden: !showL2L4 },
    { key: 'totalParents', header: 'Total Parents', isNumeric: true, width: 'w-24', render: (_r: Pollen) => formatNumber(_r.totalParents) },
    {
      key: 'totalFlowersRequiredForPollen', header: 'Flowers Req', isNumeric: true, width: 'w-24',
      render: (_r: Pollen) => formatNumber(_r.totalFlowersRequiredForPollen),
    },
    {
      key: 'totalFlowersCollected', header: 'Flowers Collected', isNumeric: true, width: 'w-28',
      render: (_r: Pollen) => formatNumber(_r.totalFlowersCollected),
    },
    {
      key: 'badPollen', header: 'Bad Pollen', isNumeric: true, width: 'w-20',
      render: (_r: Pollen) => formatNumber(_r.badPollen),
    },
    {
      key: 'flowersForPollenUsed', header: 'Pollen Used', isNumeric: true, width: 'w-24',
      render: (_r: Pollen) => formatNumber(_r.flowersForPollenUsed),
    },
    {
      key: 'flowersForPollenAvail', header: 'Pollen Avail', isNumeric: true, width: 'w-24',
      render: (_r: Pollen) => formatNumber(_r.flowersForPollenAvail),
    },
    {
      key: 'flowersForPollenVariance', header: 'Pollen To Go', isNumeric: true, width: 'w-24',
      cellClassName: (_r: Pollen) => (_r.flowersForPollenVariance ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 font-semibold' : '',
      render: (_r: Pollen) => formatNumber(_r.flowersForPollenVariance),
    },
  ];

  const pollenTotals = useMemo(() => {
    if (!rows.length) return undefined;
    return {
      totalParents: rows.reduce((s, r) => s + (r.totalParents ?? 0), 0),
      totalFlowersRequiredForPollen: rows.reduce((s, r) => s + (r.totalFlowersRequiredForPollen ?? 0), 0),
      totalFlowersCollected: rows.reduce((s, r) => s + (r.totalFlowersCollected ?? 0), 0),
      badPollen: rows.reduce((s, r) => s + (r.badPollen ?? 0), 0),
      flowersForPollenUsed: rows.reduce((s, r) => s + (r.flowersForPollenUsed ?? 0), 0),
      flowersForPollenAvail: rows.reduce((s, r) => s + (r.flowersForPollenAvail ?? 0), 0),
      flowersForPollenVariance: rows.reduce((s, r) => s + (r.flowersForPollenVariance ?? 0), 0),
    };
  }, [rows]);

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('propagation.pollen.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('propagation.pollen.description')}</p>
          </div>
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <Input
            placeholder={t('filters.searchParent')}
            value={parentSearch}
            onChange={(e) => setParentSearch(e.target.value)}
            className="w-44"
          />
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={pollenToGoOnly}
              onChange={e => setPollenToGoOnly(e.target.checked)}
              className="rounded"
            />
            {t('propagation.pollen.pollenToGo')} &gt; 0
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> {t('common.reset')}
          </Button>
          <Button
            variant={showL2L4 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowL2L4(v => !v)}
            className="gap-1.5 ml-auto"
          >
            <Columns className="w-3.5 h-3.5" />
            {t('propagation.pollen.showL2L4')}
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal}
          title={t('propagation.pollen.title')}
          data={rows}
          columns={columns}
          totals={pollenTotals as Partial<Record<string, number>> | undefined}
          isLoading={isLoading}
        />
      </div>
    </Layout>
  );
}
