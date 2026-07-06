import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import {
  useListShipping,
  useGetShippingTotals,
  useListLocations,
  useListPrograms,
  ShippingRecord,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { RotateCcw } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

export default function ShipList() {
  const { t } = useTranslation();
  const { filters } = useFilters();

  const [progenySearch, setProgenySearch] = useState('');
  const [programIds, setProgramIds] = useState<number[]>([]);
  const [destinationIds, setDestinationIds] = useState<number[]>([]);
  const [shippedOnly, setShippedOnly] = useState(false);
  const debouncedProgeny = useDebounce(progenySearch);

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    progeny: debouncedProgeny || undefined,
    programId: programIds.length ? programIds.join(',') : undefined,
    destinationId: destinationIds.length ? destinationIds.join(',') : undefined,
    shipped: shippedOnly ? 'true' as const : undefined,
    page: 1,
    pageSize: 5000,
  } as any;

  const { data: shippingData, isLoading } = useListShipping(queryParams);
  const { data: totalsData } = useGetShippingTotals(queryParams);
  const { data: locations } = useListLocations({ active: true });
  const { data: programs } = useListPrograms({ berryId: filters.berryId, active: true });

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setProgenySearch('');
    setProgramIds([]);
    setDestinationIds([]);
    setShippedOnly(false);
      setResetPageSignal(s => s + 1);
  };

  const rows = useMemo(() => shippingData?.data || [], [shippingData]);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  };

  const columns: ColumnDef<ShippingRecord>[] = [
    { key: 'progeny', header: 'Progeny', sticky: true, width: 'w-32' },
    { key: 'destination', header: 'Destination', width: 'w-28' },
    {
      key: 'shipRequest', header: 'Ship Request', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.shipRequest),
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
    {
      key: 'totalShipPlan', header: 'Total Ship Plan', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.totalShipPlan),
    },
    {
      key: 'shipTotalActual', header: 'Ship Actual Total', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.shipTotalActual),
    },
    { key: 'firstTrayBox', header: 'First Tray/Box', width: 'w-24' },
    { key: 'lastTrayBox', header: 'Last Tray/Box', width: 'w-24' },
    { key: 'rackPallet', header: 'Rack / Pallet', width: 'w-24' },
    {
      key: 'extrasNotShipped', header: 'Extras Not Shipped', isNumeric: true, width: 'w-24',
      render: (r) => formatNumber(r.extrasNotShipped),
    },
    { key: 'comments', header: 'Comments', width: 'w-40' },
    {
      key: 'shipCreatedDate', header: 'Ship Created Date', width: 'w-28',
      render: (r) => formatDate(r.shipCreatedDate),
    },
  ];

  const totals = totalsData
    ? {
        progeny: totalsData.rowCount ?? 0,
        shipRequest: totalsData.shipRequest,
        sortGroup1: totalsData.sortGroup1,
        sortGroup2: totalsData.sortGroup2,
        sortGroup3: totalsData.sortGroup3,
        sortGroup4: totalsData.sortGroup4,
        sortGroup5: totalsData.sortGroup5,
        totalShipPlan: (shippingData?.data || []).reduce((s, r) => s + (r.totalShipPlan ?? 0), 0),
        shipTotalActual: totalsData.shipTotalActual,
        extrasNotShipped: totalsData.extrasNotShipped,
      }
    : undefined;

  const programOptions = useMemo(() => {
    return (programs || []).map((p: any) => ({ value: p.id as number, label: p.srcBreedingProgram as string }));
  }, [programs]);
  const destinationOptions = useMemo(() => {
    return (locations || []).map((l: any) => ({ value: l.id as number, label: l.locationName as string }));
  }, [locations]);

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
            <h1 className="text-3xl font-display font-bold text-foreground">{t('propagation.ship.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('propagation.ship.description')}</p>
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
          <MultiSelect
            value={destinationIds}
            onChange={setDestinationIds}
            options={destinationOptions}
            placeholder="All Destinations"
            className="w-52"
          />
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={shippedOnly}
              onChange={(e) => setShippedOnly(e.target.checked)}
              className="rounded"
            />
            Shipped = Yes
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal}
          data={rows}
          columns={columns}
          title="Ship"
          totals={totals}
        />
      </div>
    </Layout>
  );
}
