import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { useFilters } from '@/contexts/FilterContext';
import { useQuery } from '@tanstack/react-query';

const apiBase: string = import.meta.env.VITE_API_BASE || "/api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { Flower2, Bean, ArrowRightLeft, Truck, MapPin, RotateCcw, Users, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/utils';
import { useListPrograms, useListLabs, customFetch } from '@workspace/api-client-react';

type AnalyticsRow = { group: string; required: number; done: number };
type MarkerAnalyticsRow = { group: string; allocation: number; crossList: number; actual: number };
type MarkerPlannedRow = { group: string; planned: number };

const TAB_KEYS = ['pollination', 'seed', 'transplant', 'ship', 'markers', 'parents'] as const;
const TAB_ICONS = {
  pollination: Flower2, seed: Bean, transplant: ArrowRightLeft,
  ship: Truck, markers: MapPin, parents: Users,
} as const;
const TAB_I18N: Record<string, string> = {
  pollination: 'analytics.pollinations', seed: 'analytics.seed',
  transplant: 'analytics.transplants', ship: 'analytics.ship',
  markers: 'analytics.markers', parents: 'analytics.parents',
};

type TabKey = typeof TAB_KEYS[number];

const GROUP_BY_KEYS = ['program', 'destination', 'team', 'year'] as const;
const GROUP_BY_I18N: Record<string, string> = {
  program: 'analytics.byProgram', destination: 'analytics.byDestination',
  team: 'analytics.byTeam', year: 'analytics.byYear',
};

const MARKER_GROUP_BY_KEYS = ['program', 'berry', 'team', 'year'] as const;
const MARKER_GROUP_BY_I18N: Record<string, string> = {
  program: 'analytics.byProgram', berry: 'analytics.byBerry',
  team: 'analytics.byTeam', year: 'analytics.byYear',
};

function useAnalyticsData(tab: TabKey, groupBy: string, capExtras: boolean) {
  const { filters } = useFilters();
  const params = new URLSearchParams();
  params.set('groupBy', groupBy);
  if (capExtras) params.set('capExtras', 'true');
  if (filters.berryId) params.set('berryId', String(filters.berryId));
  if (filters.teamId) params.set('teamId', String(filters.teamId));
  if (filters.pollinationYear) params.set('pollinationYear', String(filters.pollinationYear));
  if (filters.spCrosses) params.set('spCrosses', 'true');

  return useQuery<AnalyticsRow[]>({
    queryKey: [`/api/analytics/${tab}`, groupBy, capExtras, filters.berryId, filters.teamId, filters.pollinationYear, filters.spCrosses],
    queryFn: async ({ signal }) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${apiBase}/analytics/${tab}?${params.toString()}`, {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: tab !== 'markers',
  });
}

function useMarkerAnalyticsData(groupBy: string, metric: string, programId: string, labId: string) {
  const { filters } = useFilters();
  const params = new URLSearchParams();
  params.set('groupBy', groupBy);
  params.set('metric', metric);
  if (filters.berryId) params.set('berryId', String(filters.berryId));
  if (filters.teamId) params.set('teamId', String(filters.teamId));
  if (filters.pollinationYear) params.set('pollinationYear', String(filters.pollinationYear));
  if (filters.spCrosses) params.set('spCrosses', 'true');
  if (programId) params.set('programId', programId);
  if (labId) params.set('labId', labId);

  return useQuery<MarkerAnalyticsRow[]>({
    queryKey: ['/api/analytics/markers', groupBy, metric, filters.berryId, filters.teamId, filters.pollinationYear, filters.spCrosses, programId, labId],
    queryFn: async ({ signal }) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${apiBase}/analytics/markers?${params.toString()}`, {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

function useMarkerPlannedData(programId: string, labId: string) {
  const { filters } = useFilters();
  const params = new URLSearchParams();
  if (filters.berryId) params.set('berryId', String(filters.berryId));
  if (filters.teamId) params.set('teamId', String(filters.teamId));
  if (filters.pollinationYear) params.set('pollinationYear', String(filters.pollinationYear));
  if (filters.spCrosses) params.set('spCrosses', 'true');
  if (programId) params.set('programId', programId);
  if (labId) params.set('labId', labId);

  return useQuery<MarkerPlannedRow[]>({
    queryKey: ['/api/analytics/markers-planned-by-type', filters.berryId, filters.teamId, filters.pollinationYear, filters.spCrosses, programId, labId],
    queryFn: async ({ signal }) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${apiBase}/analytics/markers-planned-by-type?${params.toString()}`, {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

type ParentRow = { group: string; value: number };

function useParentSeedWeight(gender: string) {
  const { filters } = useFilters();
  const params = new URLSearchParams();
  params.set('gender', gender);
  if (filters.berryId) params.set('berryId', String(filters.berryId));
  if (filters.teamId) params.set('teamId', String(filters.teamId));
  if (filters.pollinationYear) params.set('pollinationYear', String(filters.pollinationYear));
  if (filters.spCrosses) params.set('spCrosses', 'true');

  return useQuery<ParentRow[]>({
    queryKey: ['/api/analytics/parents/seed-weight', gender, filters.berryId, filters.teamId, filters.pollinationYear, filters.spCrosses],
    queryFn: async ({ signal }) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${apiBase}/analytics/parents/seed-weight?${params.toString()}`, {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

function useParentFruitPct(gender: string) {
  const { filters } = useFilters();
  const params = new URLSearchParams();
  params.set('gender', gender);
  if (filters.berryId) params.set('berryId', String(filters.berryId));
  if (filters.teamId) params.set('teamId', String(filters.teamId));
  if (filters.pollinationYear) params.set('pollinationYear', String(filters.pollinationYear));
  if (filters.spCrosses) params.set('spCrosses', 'true');

  return useQuery<ParentRow[]>({
    queryKey: ['/api/analytics/parents/fruit-pct', gender, filters.berryId, filters.teamId, filters.pollinationYear, filters.spCrosses],
    queryFn: async ({ signal }) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${apiBase}/analytics/parents/fruit-pct?${params.toString()}`, {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

interface LifecycleCompletion {
  pollinationDone: boolean;
  seedDone: boolean;
  transplantDone: boolean;
  shipDone: boolean;
}

const TAB_TO_COMPLETION_KEY: Partial<Record<TabKey, keyof LifecycleCompletion>> = {
  pollination: 'pollinationDone',
  seed: 'seedDone',
  transplant: 'transplantDone',
  ship: 'shipDone',
};

function useLifecycleCompletion() {
  const { filters } = useFilters();
  const params = new URLSearchParams();
  if (filters.berryId) params.set('berryId', String(filters.berryId));
  if (filters.teamId) params.set('teamId', String(filters.teamId));
  if (filters.pollinationYear) params.set('pollinationYear', String(filters.pollinationYear));
  if (filters.spCrosses) params.set('spCrosses', 'true');

  return useQuery<LifecycleCompletion>({
    queryKey: ['lifecycle-completion', filters.berryId, filters.teamId, filters.pollinationYear, filters.spCrosses],
    queryFn: () =>
      customFetch<LifecycleCompletion>(`/api/lifecycle-status/completion?${params.toString()}`, {
        method: 'GET',
      }),
  });
}

const tooltipStyle = {
  borderRadius: '10px',
  border: '1px solid hsl(var(--border))',
  boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
  fontSize: 13,
  backgroundColor: 'hsl(var(--card))',
};

function ChartShell({ title, isLoading, isEmpty, completed, children }: { title: string; isLoading: boolean; isEmpty: boolean; completed?: boolean; children: React.ReactNode }) {
  const header = (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {completed && (
        <div className="flex items-center gap-1 text-emerald-600" title="All filtered combinations marked complete">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-xs font-medium">Complete</span>
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="bg-card p-5 rounded-2xl border shadow-sm flex flex-col h-[380px]">
        {header}
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-3 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="bg-card p-5 rounded-2xl border shadow-sm flex flex-col h-[380px]">
        {header}
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
      </div>
    );
  }
  return (
    <div className="bg-card p-5 rounded-2xl border shadow-sm flex flex-col h-[380px]">
      {header}
      <div className="flex-1 w-full">{children}</div>
    </div>
  );
}

function RequiredLabel(props: any) {
  const { x, y, width, value } = props;
  if (value == null || value === 0) return null;
  return (
    <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill="hsl(var(--muted-foreground))">
      100%
    </text>
  );
}

function DoneLabel(props: any) {
  const { x, y, width, value, index } = props;
  if (value == null || value === 0) return null;
  const required = props.requiredValues?.[index];
  const pct = required > 0 ? Math.round((value / required) * 100) : 0;
  return (
    <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill="hsl(var(--muted-foreground))">
      {pct}%
    </text>
  );
}

function BarValueLabel(props: any) {
  const { x, y, width, value } = props;
  if (value == null || value === 0) return null;
  return (
    <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill="hsl(var(--muted-foreground))">
      {formatNumber(value)}
    </text>
  );
}

const TAB_Y_LABEL: Record<string, string> = {
  pollination: 'Flowers',
  seed: 'Grams',
  transplant: 'Plants',
  ship: 'Plants',
};

const yAxisLabelStyle = { fill: 'hsl(var(--muted-foreground))', fontSize: 11, fontWeight: 600 };

function AnalyticsChart({ tab, groupBy, capExtras, title, completed }: { tab: TabKey; groupBy: string; capExtras: boolean; title: string; completed?: boolean }) {
  const { data, isLoading } = useAnalyticsData(tab, groupBy, capExtras);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map(r => ({
      name: r.group.length > 20 ? r.group.slice(0, 18) + '...' : r.group,
      fullName: r.group,
      Required: r.required,
      Done: r.done,
    }));
  }, [data]);

  return (
    <ChartShell title={title} isLoading={isLoading} isEmpty={!chartData.length} completed={completed}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 10, left: 20, bottom: chartData.length > 6 ? 60 : 20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            angle={chartData.length > 6 ? -35 : 0}
            textAnchor={chartData.length > 6 ? 'end' : 'middle'}
            height={chartData.length > 6 ? 70 : 30}
            interval={0}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickFormatter={(v: number) => formatNumber(v)}
            label={{ value: TAB_Y_LABEL[tab] || '', angle: -90, position: 'insideLeft', style: yAxisLabelStyle }}
          />
          <RechartsTooltip
            cursor={{ fill: 'hsl(var(--muted)/0.3)' }}
            contentStyle={tooltipStyle}
            formatter={(value: number) => formatNumber(value)}
            labelFormatter={(label: string, payload: any[]) => {
              if (payload?.[0]?.payload?.fullName) return payload[0].payload.fullName;
              return label;
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
          <Bar dataKey="Required" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={40} label={<RequiredLabel />} />
          <Bar dataKey="Done" fill="hsl(160, 50%, 45%)" radius={[3, 3, 0, 0]} maxBarSize={40} label={(props: any) => <DoneLabel {...props} requiredValues={chartData.map(d => d.Required)} />} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

function MarkerSummaryBar({ metric, programId, labId }: { metric: string; programId: string; labId: string }) {
  const { data, isLoading } = useMarkerAnalyticsData('program', metric, programId, labId);

  const totals = useMemo(() => {
    if (!data) return { allocation: 0, crossList: 0, actual: 0 };
    return data.reduce(
      (acc, r) => ({
        allocation: acc.allocation + r.allocation,
        crossList: acc.crossList + r.crossList,
        actual: acc.actual + r.actual,
      }),
      { allocation: 0, crossList: 0, actual: 0 }
    );
  }, [data]);

  const crossListPct = totals.allocation > 0 ? (totals.crossList / totals.allocation) * 100 : 0;
  const actualPct = totals.allocation > 0 ? (totals.actual / totals.allocation) * 100 : 0;
  const crossListDiff = crossListPct - 100;
  const actualDiff = actualPct - 100;

  const maxPct = Math.max(100, crossListPct, actualPct, 1);

  const metricLabel = metric === 'cost' ? 'Cost' : 'Samples';

  if (isLoading) {
    return (
      <div className="bg-card px-5 py-4 rounded-2xl border shadow-sm flex items-center justify-center h-[120px]">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (totals.allocation === 0 && totals.crossList === 0 && totals.actual === 0) {
    return (
      <div className="bg-card px-5 py-4 rounded-2xl border shadow-sm flex items-center justify-center h-[120px] text-sm text-muted-foreground">
        No marker data available for selected filters
      </div>
    );
  }

  const rows = [
    {
      label: 'Allocated',
      value: totals.allocation,
      pct: 100,
      diff: null as number | null,
      color: 'hsl(var(--primary))',
      barWidth: (100 / maxPct) * 100,
    },
    {
      label: 'Cross List',
      value: totals.crossList,
      pct: crossListPct,
      diff: crossListDiff,
      color: 'hsl(35, 80%, 55%)',
      barWidth: (crossListPct / maxPct) * 100,
    },
    {
      label: 'Actual',
      value: totals.actual,
      pct: actualPct,
      diff: actualDiff,
      color: 'hsl(160, 50%, 45%)',
      barWidth: (actualPct / maxPct) * 100,
    },
  ];

  return (
    <div className="bg-card px-5 py-4 rounded-2xl border shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Marker Totals — {metricLabel}</h3>
      </div>
      <div className="space-y-2.5">
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-3">
            <div className="w-[80px] text-xs font-medium text-muted-foreground text-right shrink-0">{row.label}</div>
            <div className="flex-1 h-6 bg-muted/30 rounded-md overflow-hidden relative">
              <div
                className="h-full rounded-md transition-all duration-500"
                style={{ width: `${Math.max(row.barWidth, 0.5)}%`, backgroundColor: row.color }}
              />
            </div>
            <div className="w-[160px] shrink-0 flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-foreground">{formatNumber(row.value)}</span>
              {row.diff !== null ? (
                <span className={`font-medium ${row.diff >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  ({row.diff >= 0 ? '+' : ''}{row.diff.toFixed(1)}%)
                </span>
              ) : (
                <span className="text-muted-foreground">(100%)</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkerChart({ groupBy, metric, programId, labId, title }: { groupBy: string; metric: string; programId: string; labId: string; title: string }) {
  const { data, isLoading } = useMarkerAnalyticsData(groupBy, metric, programId, labId);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map(r => ({
      name: r.group.length > 20 ? r.group.slice(0, 18) + '...' : r.group,
      fullName: r.group,
      Allocation: r.allocation,
      'Cross List': r.crossList,
      Actual: r.actual,
    }));
  }, [data]);

  const markerYLabel = metric === 'cost' ? 'Dollars' : 'Samples';

  return (
    <ChartShell title={title} isLoading={isLoading} isEmpty={!chartData.length}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 10, left: 30, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            angle={chartData.length > 4 ? -35 : 0}
            textAnchor={chartData.length > 4 ? 'end' : 'middle'}
            height={70}
            interval={0}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickFormatter={(v: number) => formatNumber(v)}
            label={{ value: markerYLabel, angle: -90, position: 'insideLeft', style: yAxisLabelStyle, offset: -15 }}
          />
          <RechartsTooltip
            cursor={{ fill: 'hsl(var(--muted)/0.3)' }}
            contentStyle={tooltipStyle}
            formatter={(value: number) => formatNumber(value)}
            labelFormatter={(label: string, payload: any[]) => {
              if (payload?.[0]?.payload?.fullName) return payload[0].payload.fullName;
              return label;
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
          <Bar dataKey="Allocation" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={40} label={<RequiredLabel />} />
          <Bar dataKey="Cross List" fill="hsl(35, 80%, 55%)" radius={[3, 3, 0, 0]} maxBarSize={40} label={(props: any) => <DoneLabel {...props} requiredValues={chartData.map(d => d.Allocation)} />} />
          <Bar dataKey="Actual" fill="hsl(160, 50%, 45%)" radius={[3, 3, 0, 0]} maxBarSize={40} label={(props: any) => <DoneLabel {...props} requiredValues={chartData.map(d => d.Allocation)} />} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

function MarkerPlannedChart({ programId, labId }: { programId: string; labId: string }) {
  const { data, isLoading } = useMarkerPlannedData(programId, labId);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map(r => ({
      name: r.group.length > 25 ? r.group.slice(0, 23) + '...' : r.group,
      fullName: r.group,
      Planned: r.planned,
    }));
  }, [data]);

  const title = 'Markers Planned — By Type';

  if (isLoading) {
    return (
      <div className="bg-card p-5 rounded-2xl border shadow-sm flex flex-col h-[380px]">
        <h3 className="text-sm font-semibold text-muted-foreground mb-4">{title}</h3>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-3 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div className="bg-card p-5 rounded-2xl border shadow-sm flex flex-col h-[380px]">
        <h3 className="text-sm font-semibold text-muted-foreground mb-4">{title}</h3>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
      </div>
    );
  }

  return (
    <div className="bg-card p-5 rounded-2xl border shadow-sm flex flex-col h-[380px]">
      <h3 className="text-sm font-semibold text-muted-foreground mb-4">{title}</h3>
      <div className="flex-1 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 10, left: 30, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              angle={chartData.length > 4 ? -35 : 0}
              textAnchor={chartData.length > 4 ? 'end' : 'middle'}
              height={70}
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              tickFormatter={(v: number) => formatNumber(v)}
              label={{ value: 'Samples', angle: -90, position: 'insideLeft', style: yAxisLabelStyle, offset: -15 }}
            />
            <RechartsTooltip
              cursor={{ fill: 'hsl(var(--muted)/0.3)' }}
              contentStyle={tooltipStyle}
              formatter={(value: number) => formatNumber(value)}
              labelFormatter={(label: string, payload: any[]) => {
                if (payload?.[0]?.payload?.fullName) return payload[0].payload.fullName;
                return label;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
            <Bar dataKey="Planned" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={50} label={<BarValueLabel />} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ParentBarChart({ data, isLoading, title, valueSuffix }: { data: ParentRow[] | undefined; isLoading: boolean; title: string; valueSuffix: string }) {
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.slice(0, 25).map(r => ({
      name: r.group.length > 20 ? r.group.slice(0, 18) + '...' : r.group,
      fullName: r.group,
      Value: r.value,
    }));
  }, [data]);

  const barHeight = Math.max(340, chartData.length * 28 + 40);

  if (isLoading) {
    return (
      <div className="bg-card p-5 rounded-2xl border shadow-sm">
        <h3 className="text-sm font-semibold text-muted-foreground mb-4">{title}</h3>
        <div className="flex items-center justify-center h-[340px]">
          <div className="w-6 h-6 border-3 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div className="bg-card p-5 rounded-2xl border shadow-sm">
        <h3 className="text-sm font-semibold text-muted-foreground mb-4">{title}</h3>
        <div className="flex items-center justify-center h-[340px] text-muted-foreground text-sm">No data available</div>
      </div>
    );
  }

  return (
    <div className="bg-card p-5 rounded-2xl border shadow-sm">
      <h3 className="text-sm font-semibold text-muted-foreground mb-4">{title}</h3>
      <div style={{ height: barHeight, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              tickFormatter={(v: number) => `${formatNumber(v)}${valueSuffix}`}
            />
            <YAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              width={140}
              interval={0}
            />
            <RechartsTooltip
              cursor={{ fill: 'hsl(var(--muted)/0.3)' }}
              contentStyle={tooltipStyle}
              formatter={(value: number) => `${formatNumber(value)}${valueSuffix}`}
              labelFormatter={(label: string, payload: any[]) => {
                if (payload?.[0]?.payload?.fullName) return payload[0].payload.fullName;
                return label;
              }}
            />
            <Bar dataKey="Value" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ParentsTab({ gender }: { gender: string }) {
  const seedWeight = useParentSeedWeight(gender);
  const fruitPct = useParentFruitPct(gender);
  const genderLabel = gender === 'female' ? 'Female' : 'Male';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <ParentBarChart
        data={seedWeight.data}
        isLoading={seedWeight.isLoading}
        title={`Avg Seed Weight per Fruit — ${genderLabel} Parent`}
        valueSuffix="g"
      />
      <ParentBarChart
        data={fruitPct.data}
        isLoading={fruitPct.isLoading}
        title={`% Fruit Collected vs Pollinations — ${genderLabel} Parent`}
        valueSuffix="%"
      />
    </div>
  );
}

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const [activeTab, setActiveTab] = useState<TabKey>('pollination');
  const [capExtras, setCapExtras] = useState(false);

  const [markerMetric, setMarkerMetric] = useState<'sample' | 'cost'>('sample');
  const [markerProgramId, setMarkerProgramId] = useState('');
  const [markerLabId, setMarkerLabId] = useState('');
  const [parentGender, setParentGender] = useState<'female' | 'male'>('female');

  const { data: programsData } = useListPrograms({ berryId: filters.berryId, active: true });
  const { data: labsData } = useListLabs();
  const { data: lifecycleCompletion } = useLifecycleCompletion();

  const programs = useMemo(() => programsData || [], [programsData]);
  const labs = useMemo(() => labsData || [], [labsData]);

  const isMarkers = activeTab === 'markers';
  const isParents = activeTab === 'parents';

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">{t('analytics.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('analytics.title')}</p>
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1 border rounded-xl p-1 bg-muted/30">
            {TAB_KEYS.map(key => {
              const Icon = TAB_ICONS[key];
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === key
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <Icon className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                  {t(TAB_I18N[key])}
                </button>
              );
            })}
          </div>

          {!isMarkers && !isParents && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none ml-auto">
              <input
                type="checkbox"
                checked={capExtras}
                onChange={e => setCapExtras(e.target.checked)}
                className="rounded border-muted-foreground/40 w-4 h-4 accent-primary"
              />
              {t('analytics.capAtRequired')}
            </label>
          )}

          {isParents && (
            <div className="flex items-center gap-2 ml-auto">
              <div className="flex items-center border rounded-lg p-0.5 bg-muted/30">
                <button
                  onClick={() => setParentGender('female')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    parentGender === 'female'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('analytics.female')}
                </button>
                <button
                  onClick={() => setParentGender('male')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    parentGender === 'male'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('analytics.male')}
                </button>
              </div>
            </div>
          )}

          {isMarkers && (
            <div className="flex items-center gap-3 ml-auto flex-wrap">
              <select
                value={markerProgramId}
                onChange={e => setMarkerProgramId(e.target.value)}
                className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
              >
                <option value="">{t('filters.allPrograms')}</option>
                {programs.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.srcBreedingProgram}</option>
                ))}
              </select>
              <select
                value={markerLabId}
                onChange={e => setMarkerLabId(e.target.value)}
                className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
              >
                <option value="">{t('filters.allLabs')}</option>
                {labs.map((l: any) => (
                  <option key={l.id} value={l.id}>{l.labName}</option>
                ))}
              </select>
              <div className="flex items-center border rounded-lg p-0.5 bg-muted/30">
                <button
                  onClick={() => setMarkerMetric('sample')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    markerMetric === 'sample'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('analytics.samples')}
                </button>
                <button
                  onClick={() => setMarkerMetric('cost')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    markerMetric === 'cost'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('analytics.cost')}
                </button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setMarkerProgramId(''); setMarkerLabId(''); setMarkerMetric('sample'); }} className="gap-1 text-muted-foreground">
                <RotateCcw className="w-3.5 h-3.5" /> {t('common.reset')}
              </Button>
            </div>
          )}
        </div>

        {!isMarkers && !isParents && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {GROUP_BY_KEYS.map(gbKey => {
              const completionKey = TAB_TO_COMPLETION_KEY[activeTab];
              const isComplete = completionKey ? lifecycleCompletion?.[completionKey] === true : false;
              return (
                <AnalyticsChart
                  key={`${activeTab}-${gbKey}`}
                  tab={activeTab}
                  groupBy={gbKey}
                  capExtras={capExtras}
                  title={`${t(TAB_I18N[activeTab])} — ${t(GROUP_BY_I18N[gbKey])}`}
                  completed={isComplete}
                />
              );
            })}
          </div>
        )}

        {isParents && (
          <div className="space-y-6">
            <div className="flex items-center justify-center py-6">
              <span className="text-3xl font-bold text-red-600 tracking-wide">Work in Progress</span>
            </div>
            <ParentsTab gender={parentGender} />
          </div>
        )}

        {isMarkers && (
          <div className="space-y-6">
            <MarkerSummaryBar metric={markerMetric} programId={markerProgramId} labId={markerLabId} />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {MARKER_GROUP_BY_KEYS.map(gbKey => (
                <MarkerChart
                  key={`markers-${gbKey}-${markerMetric}`}
                  groupBy={gbKey}
                  metric={markerMetric}
                  programId={markerProgramId}
                  labId={markerLabId}
                  title={`${t('analytics.markers')} — ${t(MARKER_GROUP_BY_I18N[gbKey])}`}
                />
              ))}
            </div>
            <MarkerPlannedChart programId={markerProgramId} labId={markerLabId} />
          </div>
        )}
      </div>
    </Layout>
  );
}
