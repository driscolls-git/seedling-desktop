import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  useListSortGroupAllocation,
  useSaveSortGroupAllocation,
  useListPrograms,
  getListShippingQueryKey,
  getListSortGroupAllocationQueryKey,
  type SortGroupAllocationRow,
  type Program,
} from '@workspace/api-client-react';
import { formatNumber, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { RotateCcw, Save, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  allocateSortGroups,
  type Priority,
} from '@/lib/sortGroupAllocation';

const SG_COUNT = 5;
const DEFAULT_PRIORITIES: Priority[] = ['EQUAL', 'EQUAL', 'EQUAL', 'EQUAL', 'EQUAL'];

function rowTotals(row: SortGroupAllocationRow): number[] {
  return [row.sortGroup1 ?? 0, row.sortGroup2 ?? 0, row.sortGroup3 ?? 0, row.sortGroup4 ?? 0, row.sortGroup5 ?? 0];
}

function persistedSplits(row: SortGroupAllocationRow): { d1: number[]; d2: number[] } {
  return {
    d1: [row.d1.sortGroup1 ?? 0, row.d1.sortGroup2 ?? 0, row.d1.sortGroup3 ?? 0, row.d1.sortGroup4 ?? 0, row.d1.sortGroup5 ?? 0],
    d2: [row.d2.sortGroup1 ?? 0, row.d2.sortGroup2 ?? 0, row.d2.sortGroup3 ?? 0, row.d2.sortGroup4 ?? 0, row.d2.sortGroup5 ?? 0],
  };
}

export default function SortGroupAllocationPage() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const { isBreeder } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [program, setProgram] = useState('');
  const [priorities, setPriorities] = useState<Priority[]>(DEFAULT_PRIORITIES);
  const [savedPriorities, setSavedPriorities] = useState<Priority[]>(DEFAULT_PRIORITIES);

  const filtersReady =
    filters.berryId !== undefined &&
    filters.teamId !== undefined &&
    filters.pollinationYear !== undefined;

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    program: program || undefined,
  };

  const { data: allocData, isLoading } = useListSortGroupAllocation(queryParams, {
    query: {
      enabled: filtersReady,
      queryKey: getListSortGroupAllocationQueryKey(queryParams),
    },
  });
  const { data: programs } = useListPrograms({ berryId: filters.berryId, active: true });
  const saveMutation = useSaveSortGroupAllocation();

  const programOptions = useMemo(() => {
    if (!programs) return [];
    return [...new Set(programs.map((p: Program) => p.srcBreedingProgram).filter(Boolean))].sort() as string[];
  }, [programs]);

  const rows = useMemo(() => allocData?.data ?? [], [allocData]);

  // Reset local state when filter set changes
  useEffect(() => {
    setPriorities(DEFAULT_PRIORITIES);
    setSavedPriorities(DEFAULT_PRIORITIES);
  }, [filters.berryId, filters.teamId, filters.pollinationYear, program]);

  // Compute splits per row from current priorities
  const computed = useMemo(() => {
    const map = new Map<number, { d1: number[]; d2: number[] }>();
    for (const r of rows) {
      const result = allocateSortGroups({
        sortGroupTotals: rowTotals(r),
        d1ShipRequest: r.d1.shipRequest ?? 0,
        d2ShipRequest: r.d2.shipRequest ?? 0,
        priorities,
      });
      map.set(r.ghsmId, { d1: result.d1, d2: result.d2 });
    }
    return map;
  }, [rows, priorities]);

  // Aggregated totals across the gallery: per SG, summed totals + planned D1/D2
  const aggregates = useMemo(() => {
    const total = new Array(SG_COUNT).fill(0);
    const d1 = new Array(SG_COUNT).fill(0);
    const d2 = new Array(SG_COUNT).fill(0);
    for (const r of rows) {
      const t = rowTotals(r);
      const c = computed.get(r.ghsmId);
      for (let i = 0; i < SG_COUNT; i++) {
        total[i] += t[i];
        d1[i] += c?.d1[i] ?? 0;
        d2[i] += c?.d2[i] ?? 0;
      }
    }
    return { total, d1, d2 };
  }, [rows, computed]);

  const isDirty = useMemo(() => {
    if (priorities.some((p, i) => p !== savedPriorities[i])) return true;
    // Also dirty if computed differs from persisted on any row
    for (const r of rows) {
      const c = computed.get(r.ghsmId);
      const p = persistedSplits(r);
      if (!c) continue;
      for (let i = 0; i < SG_COUNT; i++) {
        if (c.d1[i] !== p.d1[i] || c.d2[i] !== p.d2[i]) return true;
      }
    }
    return false;
  }, [priorities, savedPriorities, rows, computed]);

  const handleSave = async () => {
    if (rows.length === 0) return;
    const updates = rows.map(r => {
      const c = computed.get(r.ghsmId);
      return {
        ghsmId: r.ghsmId,
        d1: {
          sortGroup1: c?.d1[0] ?? 0,
          sortGroup2: c?.d1[1] ?? 0,
          sortGroup3: c?.d1[2] ?? 0,
          sortGroup4: c?.d1[3] ?? 0,
          sortGroup5: c?.d1[4] ?? 0,
        },
        d2: {
          sortGroup1: c?.d2[0] ?? 0,
          sortGroup2: c?.d2[1] ?? 0,
          sortGroup3: c?.d2[2] ?? 0,
          sortGroup4: c?.d2[3] ?? 0,
          sortGroup5: c?.d2[4] ?? 0,
        },
      };
    });
    try {
      const res = await saveMutation.mutateAsync({ data: { updates } });
      toast({
        title: t('propagation.sortAllocation.savedTitle'),
        description: t('propagation.sortAllocation.savedDescription', { count: res.updatedCount ?? 0 }),
      });
      setSavedPriorities(priorities);
      queryClient.invalidateQueries({ queryKey: getListShippingQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSortGroupAllocationQueryKey() });
    } catch (err) {
      toast({
        title: t('common.networkError'),
        description: err instanceof Error ? err.message : 'Save failed',
        variant: 'destructive',
      });
    }
  };

  const handleReset = () => {
    setPriorities(DEFAULT_PRIORITIES);
    setProgram('');
  };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('propagation.sortAllocation.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('propagation.sortAllocation.description')}</p>
          </div>
          {isBreeder && filtersReady && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saveMutation.isPending || !isDirty || rows.length === 0}
              className="gap-1.5 rounded-lg"
            >
              <Save className="w-3.5 h-3.5" />
              {t('propagation.sortAllocation.saveAll')}
            </Button>
          )}
        </div>

        {!filtersReady ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-amber-900">{t('propagation.sortAllocation.filtersRequiredTitle')}</div>
              <p className="text-sm text-amber-800 mt-1">
                {t('propagation.sortAllocation.filtersRequiredBody')}
              </p>
              <ul className="text-sm text-amber-800 mt-2 ms-5 list-disc">
                {filters.berryId === undefined && <li>{t('filters.berry')}</li>}
                {filters.teamId === undefined && <li>{t('filters.team')}</li>}
                {filters.pollinationYear === undefined && <li>{t('filters.pollinationYear')}</li>}
              </ul>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">{t('common.filter')}</h3>
              <select
                className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                value={program}
                onChange={(e) => setProgram(e.target.value)}
              >
                <option value="">{t('filters.allPrograms')}</option>
                {programOptions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1 text-muted-foreground">
                <RotateCcw className="w-3.5 h-3.5" /> {t('common.reset')}
              </Button>
              <div className="text-sm text-muted-foreground ms-auto">
                {t('propagation.sortAllocation.rowCount', { count: rows.length })}
              </div>
            </div>

            {/* Priority controls + aggregated totals */}
            <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b bg-secondary/5">
                <div className="font-semibold text-foreground">{t('propagation.sortAllocation.galleryTotalsTitle')}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t('propagation.sortAllocation.galleryTotalsDesc')}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground uppercase bg-card border-b">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold w-44">{t('propagation.sortAllocation.sortGroup')}</th>
                      <th className="px-3 py-2 text-right font-semibold w-24">{t('propagation.sortAllocation.total')}</th>
                      <th className="px-3 py-2 text-left font-semibold w-44">{t('propagation.sortAllocation.priority')}</th>
                      <th className="px-3 py-2 text-right font-semibold w-28 bg-sky-50/40">{t('propagation.sortAllocation.toD1')}</th>
                      <th className="px-3 py-2 text-right font-semibold w-28 bg-violet-50/40">{t('propagation.sortAllocation.toD2')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3, 4].map(i => (
                      <tr key={i} className="border-b last:border-0 even:bg-secondary/5">
                        <td className="px-3 py-2 font-medium">{t('propagation.sortAllocation.sgRow', { n: i + 1 })}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatNumber(aggregates.total[i])}</td>
                        <td className="px-3 py-2">
                          <select
                            value={priorities[i]}
                            disabled={!isBreeder || rows.length === 0}
                            onChange={(e) => {
                              const v = e.target.value as Priority;
                              setPriorities(prev => prev.map((p, idx) => (idx === i ? v : p)));
                            }}
                            className={cn(
                              "border rounded-md px-2 py-1 text-sm bg-background focus:ring-1 focus:ring-primary outline-none",
                              "disabled:opacity-50 disabled:cursor-not-allowed",
                              priorities[i] !== savedPriorities[i] && "border-amber-300"
                            )}
                          >
                            <option value="EQUAL">{t('propagation.sortAllocation.equal')}</option>
                            <option value="D1">{t('propagation.sortAllocation.d1Priority')}</option>
                            <option value="D2">{t('propagation.sortAllocation.d2Priority')}</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right font-mono bg-sky-50/40">{formatNumber(aggregates.d1[i])}</td>
                        <td className="px-3 py-2 text-right font-mono bg-violet-50/40">{formatNumber(aggregates.d2[i])}</td>
                      </tr>
                    ))}
                    <tr className="bg-primary/5 font-semibold border-t-2 border-primary/20">
                      <td className="px-3 py-2.5">{t('propagation.sortAllocation.totalsRow')}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{formatNumber(aggregates.total.reduce((a, b) => a + b, 0))}</td>
                      <td></td>
                      <td className="px-3 py-2.5 text-right font-mono bg-sky-50/40">{formatNumber(aggregates.d1.reduce((a, b) => a + b, 0))}</td>
                      <td className="px-3 py-2.5 text-right font-mono bg-violet-50/40">{formatNumber(aggregates.d2.reduce((a, b) => a + b, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Gallery */}
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <div className="bg-card rounded-2xl border p-12 text-center text-muted-foreground">
                {t('propagation.sortAllocation.noEligible')}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {rows.map(row => (
                  <ProgenyCard
                    key={row.ghsmId}
                    row={row}
                    splits={computed.get(row.ghsmId)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

interface CardProps {
  row: SortGroupAllocationRow;
  splits: { d1: number[]; d2: number[] } | undefined;
}

function ProgenyCard({ row, splits }: CardProps) {
  const { t } = useTranslation();
  const totals = rowTotals(row);
  const d1Total = (splits?.d1 ?? []).reduce((a, b) => a + b, 0);
  const d2Total = (splits?.d2 ?? []).reduce((a, b) => a + b, 0);
  const d1Req = row.d1.shipRequest ?? 0;
  const d2Req = row.d2.shipRequest ?? 0;

  const summaryClass = (planned: number, request: number) => {
    if (request === 0) return 'text-muted-foreground';
    if (planned === request) return 'text-emerald-600';
    if (planned > request) return 'text-amber-600';
    return 'text-rose-600';
  };

  return (
    <div className="bg-card rounded-2xl border shadow-sm overflow-hidden flex flex-col">
      <div className="p-3 border-b bg-secondary/5">
        <div className="font-semibold text-sm text-foreground truncate" title={row.progeny ?? ''}>{row.progeny}</div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">
          {row.berry} · {row.teamName} · {row.pollinationYear}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] text-muted-foreground uppercase bg-card border-b">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">{t('propagation.sortAllocation.sortGroup')}</th>
              <th className="px-2 py-1.5 text-right font-semibold">{t('propagation.sortAllocation.total')}</th>
              <th className="px-2 py-1.5 text-right font-semibold bg-sky-50/40">{t('propagation.sortAllocation.toD1')}</th>
              <th className="px-2 py-1.5 text-right font-semibold bg-violet-50/40">{t('propagation.sortAllocation.toD2')}</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map(i => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-2 py-1 font-medium">{t('propagation.sortAllocation.sgRow', { n: i + 1 })}</td>
                <td className="px-2 py-1 text-right font-mono">{formatNumber(totals[i])}</td>
                <td className="px-2 py-1 text-right font-mono bg-sky-50/40">{formatNumber(splits?.d1[i] ?? 0)}</td>
                <td className="px-2 py-1 text-right font-mono bg-violet-50/40">{formatNumber(splits?.d2[i] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-0 border-t text-xs mt-auto">
        <div className="p-2.5 bg-sky-50/30 border-e">
          <div className="text-[10px] uppercase tracking-wider text-sky-700 font-semibold">{t('propagation.sortAllocation.dest1')}</div>
          <div className="font-medium truncate" title={row.d1.destination ?? ''}>{row.d1.destination || '—'}</div>
          <div className="text-[10px] text-muted-foreground truncate">{t('filters.program')}: {row.d1.program || '—'}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[10px] text-muted-foreground">{t('propagation.sortAllocation.shipRequest')}:</span>
            <span className="font-mono font-semibold">{formatNumber(d1Req)}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] text-muted-foreground">{t('propagation.sortAllocation.planned')}:</span>
            <span className={cn("font-mono font-semibold", summaryClass(d1Total, d1Req))}>{formatNumber(d1Total)}</span>
          </div>
        </div>
        <div className="p-2.5 bg-violet-50/30">
          <div className="text-[10px] uppercase tracking-wider text-violet-700 font-semibold">{t('propagation.sortAllocation.dest2')}</div>
          <div className="font-medium truncate" title={row.d2.destination ?? ''}>{row.d2.destination || '—'}</div>
          <div className="text-[10px] text-muted-foreground truncate">{t('filters.program')}: {row.d2.program || '—'}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[10px] text-muted-foreground">{t('propagation.sortAllocation.shipRequest')}:</span>
            <span className="font-mono font-semibold">{formatNumber(d2Req)}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] text-muted-foreground">{t('propagation.sortAllocation.planned')}:</span>
            <span className={cn("font-mono font-semibold", summaryClass(d2Total, d2Req))}>{formatNumber(d2Total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
