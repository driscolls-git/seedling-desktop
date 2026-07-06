import React from 'react';
import { useTranslation } from 'react-i18next';
import { useFilters } from '@/contexts/FilterContext';
import { useGetDashboardSummary } from '@workspace/api-client-react';
import { Layout } from '@/components/layout/Layout';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  FunnelChart, Funnel, LabelList, Cell,
} from 'recharts';
import { Flower2, Bean, ArrowRightLeft, Truck } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { motion } from 'framer-motion';

const FUNNEL_COLORS = [
  'hsl(198, 90%, 30%)',
  'hsl(198, 90%, 40%)',
  'hsl(215, 25%, 45%)',
  'hsl(180, 40%, 50%)',
  'hsl(160, 50%, 45%)',
];

export default function Home() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const { data: summary, isLoading } = useGetDashboardSummary({
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    spCrosses: filters.spCrosses
  });

  const funnelData = [
    { name: t('home.shipRequest'), value: summary?.totalShipRequest || 0 },
    { name: t('home.transplantsRequired'), value: summary?.totalTransplantsRequired || 0 },
    { name: t('home.pollinationsRequired'), value: summary?.totalPollinationsRequired || 0 },
    { name: t('home.crosses'), value: summary?.totalActiveCrosses || 0 },
  ];

  if (isLoading) {
    return (
      <Layout>
        <div className="w-full h-64 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">{t('home.dashboardOverview')}</h1>
          <p className="text-muted-foreground mt-1">{t('home.summaryMetrics', { year: filters.pollinationYear })}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            { title: t('home.pollinationProgress'), pct: summary?.pollinationProgress || 0, total: summary?.totalPollinationsRequired, totalLabel: t('home.required'), icon: Flower2 },
            { title: t('home.seedProgress'), pct: summary?.seedProgress || 0, total: summary?.totalSeedRequired, totalLabel: t('home.requiredG'), icon: Bean },
            { title: t('home.transplantProgress'), pct: summary?.transplantProgress || 0, total: summary?.totalTransplantsRequired, totalLabel: t('home.required'), icon: ArrowRightLeft },
            { title: t('home.shipProgress'), pct: summary?.shipProgress || 0, total: summary?.totalShipRequest, totalLabel: t('home.requested'), icon: Truck },
          ].map((card, i) => {
            const pct = Math.min(Math.max(card.pct, 0), 100);
            const r = pct <= 50 ? 255 : Math.round(255 - (pct - 50) * 2 * 2.55);
            const g = pct >= 50 ? 200 : Math.round(pct * 2 * (200 / 100));
            const barColor = `rgb(${r}, ${g}, 0)`;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="bg-card p-6 rounded-2xl border shadow-sm"
              >
                <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                  <card.icon className="w-4 h-4" />
                  {card.title}
                </h3>
                <div className="flex items-baseline justify-between mb-4">
                  <span className="text-4xl font-bold font-display text-foreground">{card.pct}%</span>
                  <span className="text-4xl font-bold font-display text-foreground">{formatNumber(card.total)} <span className="text-base font-medium text-muted-foreground">{card.totalLabel}</span></span>
                </div>
                <div className="w-full h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-card p-6 rounded-2xl border shadow-sm flex flex-col h-[400px]">
            <h3 className="text-lg font-semibold mb-6">{t('home.crossesByBerry')}</h3>
            <div className="flex-1 w-full h-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary?.crossesByBerry || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="berry" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <RechartsTooltip
                    cursor={{ fill: 'hsl(var(--muted)/0.5)' }}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={50}>
                    <LabelList dataKey="count" position="top" fill="hsl(var(--foreground))" fontSize={12} formatter={(v: number) => formatNumber(v)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-card p-6 rounded-2xl border shadow-sm flex flex-col h-[400px]">
            <h3 className="text-lg font-semibold mb-6">{t('home.propagationFunnel')}</h3>
            <div className="flex-1 w-full h-full">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart margin={{ right: 180 }}>
                  <RechartsTooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive>
                    {funnelData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]} />
                    ))}
                    <LabelList
                      position="right"
                      fill="hsl(var(--foreground))"
                      fontSize={13}
                      dataKey="name"
                      content={({ x, y, width, height, index }: any) => {
                        const entry = funnelData[index];
                        if (!entry) return null;
                        const labelX = (x ?? 0) + (width ?? 0) + 14;
                        const labelY = (y ?? 0) + (height ?? 0) / 2;
                        return (
                          <g>
                            <text x={labelX} y={labelY - 7} fill="hsl(var(--foreground))" fontSize={13} dominantBaseline="middle">{entry.name}</text>
                            <text x={labelX} y={labelY + 11} fill="hsl(var(--muted-foreground))" fontSize={12} fontWeight={600} dominantBaseline="middle">{formatNumber(entry.value)}</text>
                          </g>
                        );
                      }}
                    />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
