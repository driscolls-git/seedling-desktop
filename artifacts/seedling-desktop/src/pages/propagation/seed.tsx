import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import {
  useListSeed, useGetSeedTotals,
  useListPrograms, SeedRow,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { RotateCcw, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

const SEED_CALCS = [
  {
    factor: 'Seed Weight To Sow',
    calculation: 'If (Seed Weight Inventory − Seed Sow Buffer Grams) ≤ Seed Weight Required → use Seed Weight Inventory; otherwise → use Seed Weight Required',
  },
  {
    factor: 'Seed Weight To Bank',
    calculation: 'If Seed Weight To Sow = Seed Weight Inventory → 0; otherwise → Seed Weight Inventory − Seed Weight To Sow',
  },
  {
    factor: 'Seed Sow To Go',
    calculation: 'If Seed Weight To Sow = Seed Weight Inventory → Seed Weight Inventory − Seed Weight Sown; otherwise → Seed Weight To Sow − Seed Weight Sown',
  },
  {
    factor: 'Acid Treat All?',
    calculation: 'True when Seed Weight To Bank = 0 (all collected seed will be sown, none banked)',
  },
  {
    factor: 'Seed Ready For Acid?',
    calculation: 'True when any of: (1) ≥ 90% of fruit has been collected, (2) ≥ 90% of seed required has been collected, or (3) today is the acid deadline AND there is seed available to treat',
  },
];

export default function SeedList() {
  const { t } = useTranslation();
  const { filters } = useFilters();

  const [progenySearch, setProgenySearch] = useState('');
  const [showCalcs, setShowCalcs] = useState(false);
  const [programIds, setProgramIds] = useState<number[]>([]);
  const [seedSowToGoOnly, setSeedSowToGoOnly] = useState(false);
  const [sowSeedOnly, setSowSeedOnly] = useState(true);
  const [acidDateRangeOnly, setAcidDateRangeOnly] = useState(false);
  const debouncedProgeny = useDebounce(progenySearch);

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    spCrosses: filters.spCrosses,
    progeny: debouncedProgeny || undefined,
    programId: programIds.length ? programIds.join(',') : undefined,
    active: true,
    seedSowToGo: seedSowToGoOnly || undefined,
    sowSeed: sowSeedOnly ? true : undefined,
    acidInDateRange: acidDateRangeOnly || undefined,
    page: 1,
    pageSize: 5000,
    sortBy: 'progeny' as string,
  } as any;

  const { data: seedData, isLoading } = useListSeed(queryParams);
  const { data: totalsData } = useGetSeedTotals(queryParams);
  const { data: programs } = useListPrograms({ berryId: filters.berryId, active: true });

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setProgenySearch('');
    setProgramIds([]);
    setSeedSowToGoOnly(false);
    setSowSeedOnly(true);
    setAcidDateRangeOnly(false);
      setResetPageSignal(s => s + 1);
  };

  const rows = useMemo(() => (seedData?.data || []) as SeedRow[], [seedData]);

  const berryType = filters.berryId;
  const isBlueberry = berryType === 2;
  const acidLabel = isBlueberry ? 'GA' : 'Acid';

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  };

  const columns: ColumnDef<SeedRow>[] = [
    { key: 'progeny', header: 'Progeny', sticky: true, width: 'w-32' },
    { key: 'd1Program', header: 'Program Dest 1', width: 'w-32' },
    { key: 'd2Program', header: 'Program Dest 2', width: 'w-32' },
    {
      key: 'totalFruitCollected', header: 'Fruit Collected', isNumeric: true, width: 'w-24',
      render: (r: SeedRow) => formatNumber(r.totalFruitCollected, 0),
    },
    { key: 'commentsFruit', header: 'Comments (Fruit)', width: 'w-64' },
    {
      key: 'seedWeightRequired', header: 'Seed Req (G)', isNumeric: true, width: 'w-24',
      render: (r: SeedRow) => formatNumber(r.seedWeightRequired, 4),
    },
    {
      key: 'seedWeightInventory', header: 'Seed Collected (G)', isNumeric: true, width: 'w-24',
      render: (r: SeedRow) => formatNumber(r.seedWeightInventory, 4),
    },
    {
      key: 'seedWeightVariance', header: 'Seed Collected To Go (G)', isNumeric: true, width: 'w-24',
      cellClassName: (r: SeedRow) => (r.seedWeightVariance ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 font-semibold' : '',
      render: (r: SeedRow) => formatNumber(r.seedWeightVariance, 4),
    },
    {
      key: 'acidTreatAll', header: `${acidLabel} Treat All?`, width: 'w-24',
      cellClassName: (r: SeedRow) => r.acidTreatAll ? 'bg-teal-100 text-teal-800 font-semibold' : '',
      render: (r: SeedRow) => r.acidTreatAll ? 'Yes' : 'No',
    },
    {
      key: 'seedReadyForAcid', header: `Seed Ready for ${acidLabel}?`, width: 'w-24',
      cellClassName: (r: SeedRow) => r.seedReadyForAcid ? 'bg-teal-100 text-teal-800 font-semibold' : '',
      render: (r: SeedRow) => r.seedReadyForAcid ? 'Yes' : 'No',
    },
    {
      key: 'acidInDateRange', header: `Now in ${acidLabel} Date Range`, width: 'w-24',
      cellClassName: (r: SeedRow) => r.acidInDateRange ? 'bg-teal-100 text-teal-800 font-semibold' : '',
      render: (r: SeedRow) => r.acidInDateRange ? 'Yes' : 'No',
    },
    {
      key: 'acidStartDate', header: `D1 ${acidLabel} Treat Start`, width: 'w-28',
      render: (r: SeedRow) => formatDate(r.acidStartDate),
    },
    {
      key: 'acidDeadlineDate', header: `D1 ${acidLabel} Treat Deadline`, width: 'w-28',
      render: (r: SeedRow) => formatDate(r.acidDeadlineDate),
    },
    {
      key: 'seedWeightAcidTreated', header: `Seed ${acidLabel} Treated (G)`, isNumeric: true, width: 'w-24',
      render: (r: SeedRow) => formatNumber(r.seedWeightAcidTreated, 4),
    },
    {
      key: 'seedAcidWeightVariance', header: `Seed ${acidLabel} To Go (G)`, isNumeric: true, width: 'w-24',
      cellClassName: (r: SeedRow) => (r.seedAcidWeightVariance ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 font-semibold' : '',
      render: (r: SeedRow) => formatNumber(r.seedAcidWeightVariance, 4),
    },
    {
      key: 'sowSeed', header: 'Sow Seed?', width: 'w-20',
      render: (r: SeedRow) => r.sowSeed ? 'Yes' : 'No',
    },
    {
      key: 'seedWeightToSow', header: 'Seed To Sow (G)', isNumeric: true, width: 'w-24',
      render: (r: SeedRow) => formatNumber(r.seedWeightToSow, 4),
    },
    {
      key: 'seedWeightToBank', header: 'Seed To Bank (G)', isNumeric: true, width: 'w-24',
      render: (r: SeedRow) => formatNumber(r.seedWeightToBank, 4),
    },
    {
      key: 'totalSeedWeightSown', header: 'Seed Sown Total (G)', isNumeric: true, width: 'w-24',
      render: (r: SeedRow) => formatNumber(r.totalSeedWeightSown, 4),
    },
    {
      key: 'seedSowToGo', header: 'Seed Sow To Go (G)', isNumeric: true, width: 'w-24',
      cellClassName: (r: SeedRow) => (r.seedSowToGo ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 font-semibold' : '',
      render: (r: SeedRow) => formatNumber(r.seedSowToGo, 4),
    },
    {
      key: 'id', header: 'ID', isNumeric: true, width: 'w-16',
    },
  ];

  const seedTotals = useMemo(() => {
    if (!totalsData) return undefined;
    return totalsData as Partial<Record<string, number>>;
  }, [totalsData]);

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('propagation.seed.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('propagation.seed.description')}</p>
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
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={seedSowToGoOnly}
              onChange={e => setSeedSowToGoOnly(e.target.checked)}
              className="rounded"
            />
            Seed Sow To Go &gt; 0
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={sowSeedOnly}
              onChange={e => setSowSeedOnly(e.target.checked)}
              className="rounded"
            />
            Sow Seed (Do Not Bank/Store)
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={acidDateRangeOnly}
              onChange={e => setAcidDateRangeOnly(e.target.checked)}
              className="rounded"
            />
            Now in {acidLabel} Date Range
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal}
          title="Seed"
          data={rows}
          columns={columns}
          totals={seedTotals}
          isLoading={isLoading}
        />

        <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
          <button
            onClick={() => setShowCalcs(v => !v)}
            className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-secondary/10 transition-colors"
          >
            <Info className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">How the Seed Calculations Work</span>
            {showCalcs ? <ChevronUp className="w-4 h-4 ml-auto text-muted-foreground" /> : <ChevronDown className="w-4 h-4 ml-auto text-muted-foreground" />}
          </button>
          {showCalcs && (
            <div className="px-5 pb-4">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-semibold text-muted-foreground w-48">Column</th>
                    <th className="text-left py-2 font-semibold text-muted-foreground">Calculation</th>
                  </tr>
                </thead>
                <tbody>
                  {SEED_CALCS.map((c, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-primary whitespace-nowrap">{c.factor}</td>
                      <td className="py-2.5 text-muted-foreground">{c.calculation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
