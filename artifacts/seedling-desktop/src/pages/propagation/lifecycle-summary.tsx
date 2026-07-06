import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useCallback } from 'react';
import { Layout } from '@/components/layout/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FilterContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch, useListTeams } from '@workspace/api-client-react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface LifecycleRow {
  berry: string;
  teamName: string;
  pollinationYear: number;
  progenyCount: number;
  berryId: number | null;
  teamId: number | null;
  spCrosses: number;
  pollenDone: number;
  pollinationDone: number;
  fruitDone: number;
  seedDone: number;
  transplantDone: number;
  screenDone: number;
  shipDone: number;
  modifiedBy: string | null;
  modifiedDateTime: string | null;
}

const STEP_KEYS = ['pollenDone', 'pollinationDone', 'fruitDone', 'seedDone', 'transplantDone', 'screenDone', 'shipDone'] as const;
const STEP_I18N: Record<string, string> = {
  pollenDone: 'propagation.lifecycle.pollenDone',
  pollinationDone: 'propagation.lifecycle.pollinationDone',
  fruitDone: 'propagation.lifecycle.fruitDone',
  seedDone: 'propagation.lifecycle.seedDone',
  transplantDone: 'propagation.lifecycle.transplantDone',
  screenDone: 'propagation.lifecycle.screenDone',
  shipDone: 'propagation.lifecycle.shipDone',
};

type StepKey = (typeof STEP_KEYS)[number];

function rowKey(r: LifecycleRow) {
  return `${r.berry}||${r.teamName}||${r.pollinationYear}`;
}

export default function LifecycleSummary() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const { filters } = useFilters();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [updating, setUpdating] = useState<string | null>(null);

  const { data, isLoading } = useQuery<LifecycleRow[]>({
    queryKey: ['lifecycle-status'],
    queryFn: () => customFetch<LifecycleRow[]>('/api/lifecycle-status', { method: 'GET' }),
  });

  const { data: teams } = useListTeams({ active: true });
  const teamsMap = useMemo(() => {
    const map = new Map<number, string>();
    if (Array.isArray(teams)) {
      teams.forEach((tm: any) => {
        if (tm.id && tm.teamName) map.set(tm.id, tm.teamName);
      });
    }
    return map;
  }, [teams]);

  const rows = useMemo(() => {
    const allRows = data ?? [];
    return allRows.filter((row) => {
      if (filters.berryId != null && row.berryId !== filters.berryId) return false;
      if (filters.teamId != null) {
        const filterTeamName = teamsMap.get(filters.teamId);
        if (filterTeamName && row.teamName !== filterTeamName) return false;
      }
      if (filters.pollinationYear && row.pollinationYear !== filters.pollinationYear) return false;
      if (filters.spCrosses && row.spCrosses !== 1) return false;
      return true;
    });
  }, [data, filters, teamsMap]);

  const toggleStep = useCallback(
    async (row: LifecycleRow, step: StepKey) => {
      if (!isAdmin) return;
      if (row.berryId == null || row.teamId == null) {
        toast({ title: 'Cannot update', description: 'Missing berry/team identifier on this row.', variant: 'destructive' });
        return;
      }
      const key = `${rowKey(row)}:${step}`;
      setUpdating(key);
      try {
        await customFetch('/api/lifecycle-status', {
          method: 'PATCH',
          body: JSON.stringify({
            // Backend keys on Berry_ID + Team_ID (not the display names).
            berryId: row.berryId,
            teamId: row.teamId,
            pollinationYear: row.pollinationYear,
            step,
            value: row[step] === 0,
          }),
          headers: { 'Content-Type': 'application/json' },
        });
        queryClient.invalidateQueries({ queryKey: ['lifecycle-status'] });
      } catch (err) {
        console.error('Failed to update lifecycle status:', err);
        const msg = err instanceof Error ? err.message : 'Failed to update lifecycle status.';
        toast({ title: 'Update failed', description: msg, variant: 'destructive' });
      } finally {
        setUpdating(null);
      }
    },
    [isAdmin, queryClient, toast],
  );

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <ClipboardCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('propagation.lifecycle.title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('propagation.lifecycle.description')}
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-320px)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-card border-b border-border shadow-[0_2px_4px_-1px_rgba(0,0,0,0.06)]">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('propagation.lifecycle.berry')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('propagation.lifecycle.teamName')}</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('propagation.lifecycle.pollinationYear')}</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('propagation.lifecycle.progenyCount')}</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('filters.spCrosses')}</th>
                  {STEP_KEYS.map((key) => (
                    <th
                      key={key}
                      className="text-center px-3 py-3 font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {t(STEP_I18N[key])}
                    </th>
                  ))}
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('propagation.lifecycle.lastModified')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5 + STEP_KEYS.length + 1} className="px-4 py-12 text-center">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {t('common.loading')}
                      </div>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5 + STEP_KEYS.length + 1} className="px-4 py-12 text-center text-muted-foreground">
                      {t('common.noData')}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const rk = rowKey(row);
                    return (
                      <tr
                        key={rk}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{row.berry}</td>
                        <td className="px-4 py-3 text-foreground whitespace-nowrap">{row.teamName}</td>
                        <td className="px-4 py-3 text-center text-foreground">{row.pollinationYear}</td>
                        <td className="px-4 py-3 text-center font-semibold text-foreground">{row.progenyCount}</td>
                        <td className="px-4 py-3 text-center text-foreground">{row.spCrosses === 1 ? t('common.yes') : t('common.no')}</td>
                        {STEP_KEYS.map((stepKey) => {
                          const checked = row[stepKey] === 1;
                          const cellKey = `${rk}:${stepKey}`;
                          const isUpdating = updating === cellKey;
                          return (
                            <td key={stepKey} className="px-3 py-3 text-center">
                              {isUpdating ? (
                                <Loader2 className="w-4 h-4 animate-spin text-primary mx-auto" />
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!isAdmin}
                                  onChange={() => toggleStep(row, stepKey)}
                                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-80 accent-primary"
                                />
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {row.modifiedBy
                            ? `${row.modifiedBy} — ${new Date(row.modifiedDateTime!).toLocaleDateString()}`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
