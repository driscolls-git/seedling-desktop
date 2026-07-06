import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  useListLabPrices,
  useCreateLabPrice,
  useUpdateLabPrice,
  useDeleteLabPrice,
  useListBerries,
  useListGenotypeScreens,
  useListLabs,
  LabPrice,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Plus, Save, Trash2, RotateCcw, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

type EditableRow = {
  id: number | null;
  samplePrice: number | '';
  year: number | '';
  berryId: number | '';
  genotypeScreenId: number | '';
  ghLabId: number | '';
  isNew?: boolean;
  isDirty?: boolean;
};

function toEditable(row: LabPrice): EditableRow {
  return {
    id: row.id,
    samplePrice: row.samplePrice ?? '',
    year: row.year ?? '',
    berryId: row.berryId ?? '',
    genotypeScreenId: row.genotypeScreenId ?? '',
    ghLabId: row.ghLabId ?? '',
  };
}

const emptyRow: EditableRow = {
  id: null,
  samplePrice: '',
  year: '',
  berryId: '',
  genotypeScreenId: '',
  ghLabId: '',
  isNew: true,
  isDirty: true,
};

export default function MarkerPricesPage() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const { isMolecular } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [screenFilter, setScreenFilter] = useState('');
  const [labFilter, setLabFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const queryParams = {
    berryId: filters.berryId,
    ...(filters.pollinationYear ? { year: filters.pollinationYear } : {}),
    ...(screenFilter ? { genotypeScreenId: parseInt(screenFilter) } : {}),
    ...(labFilter ? { labId: parseInt(labFilter) } : {}),
  };

  const { data: pricesData } = useListLabPrices(queryParams);
  const { data: berriesData } = useListBerries();
  const { data: screensData } = useListGenotypeScreens();
  const { data: labsData } = useListLabs();

  const createMutation = useCreateLabPrice();
  const updateMutation = useUpdateLabPrice();
  const deleteMutation = useDeleteLabPrice();

  const [editRows, setEditRows] = useState<EditableRow[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  // Auto-fit page size to viewport (matches the DataTable component's behavior).
  // Pagination is hidden while editing, so we only recompute in read-only mode.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isEditing) return;
    const ROW_H = 41;
    const HEADER_H = 44;
    const FOOTER_H = 60;
    const compute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const available = window.innerHeight - top - FOOTER_H;
      const usable = available - HEADER_H;
      setPageSize(Math.max(5, Math.floor(usable / ROW_H)));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [isEditing]);

  const serverRows = useMemo(() => (pricesData || []) as LabPrice[], [pricesData]);

  const allDisplayRows = isEditing ? editRows : serverRows.map(toEditable);
  const totalPages = Math.max(1, Math.ceil(allDisplayRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const displayRows = isEditing ? allDisplayRows : allDisplayRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const startEditing = () => {
    setEditRows(serverRows.map(toEditable));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setEditRows([]);
    setIsEditing(false);
  };

  const addRow = () => {
    setEditRows(prev => [...prev, { ...emptyRow, year: filters.pollinationYear || '' }]);
  };

  const updateRow = (index: number, field: keyof EditableRow, value: number | '') => {
    setEditRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value, isDirty: true } : r));
  };

  const removeRow = (index: number) => {
    setEditRows(prev => prev.filter((_, i) => i !== index));
  };

  const isRowValid = (row: EditableRow) =>
    row.samplePrice !== '' &&
    row.year !== '' &&
    row.berryId !== '' &&
    row.genotypeScreenId !== '' &&
    row.ghLabId !== '';

  const saveAll = async () => {
    const invalid = editRows.filter(r => r.isDirty && !isRowValid(r));
    if (invalid.length > 0) {
      toast({ title: 'Validation Error', description: 'All columns are required before saving.', variant: 'destructive' });
      return;
    }

    try {
      for (const row of editRows) {
        if (!row.isDirty) continue;
        const payload = {
          samplePrice: Number(row.samplePrice),
          year: Number(row.year),
          berryId: Number(row.berryId),
          genotypeScreenId: Number(row.genotypeScreenId),
          ghLabId: Number(row.ghLabId),
        };

        if (row.isNew) {
          await createMutation.mutateAsync({ data: payload });
        } else {
          await updateMutation.mutateAsync({ id: row.id!, data: payload });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['/api/lab-prices'] });
      toast({ title: 'Saved', description: 'Marker prices saved successfully.' });
      setIsEditing(false);
      setEditRows([]);
    } catch {
      toast({ title: 'Error', description: 'Failed to save marker prices.', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: number, index: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      setEditRows(prev => prev.filter((_, i) => i !== index));
      queryClient.invalidateQueries({ queryKey: ['/api/lab-prices'] });
      toast({ title: 'Deleted', description: 'Marker price deleted.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete.', variant: 'destructive' });
    }
  };

  const resetFilters = () => {
    setScreenFilter('');
    setLabFilter('');
  };

  const berries = useMemo(() => berriesData || [], [berriesData]);
  const screens = useMemo(() => screensData || [], [screensData]);
  const labs = useMemo(() => labsData || [], [labsData]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const selectClass = "w-full border rounded px-2 py-1 text-sm bg-background focus:ring-1 focus:ring-primary outline-none";
  const inputClass = "w-full border rounded px-2 py-1 text-sm bg-background text-right focus:ring-1 focus:ring-primary outline-none";

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('reference.markerPrices.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('reference.markerPrices.description')}</p>
          </div>
          {isMolecular && (
            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <Button size="sm" variant="outline" onClick={addRow} className="gap-1.5 rounded-lg">
                    <Plus className="w-3.5 h-3.5" /> Add Row
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelEditing} className="gap-1.5 rounded-lg">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </Button>
                  <Button size="sm" onClick={saveAll} disabled={isSaving} className="gap-1.5 rounded-lg">
                    <Save className="w-3.5 h-3.5" /> {isSaving ? 'Saving...' : 'Save All'}
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={startEditing} className="gap-1.5 rounded-lg">
                  Edit
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <select
            value={screenFilter}
            onChange={e => setScreenFilter(e.target.value)}
            className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
          >
            <option value="">All Genotyping Screens</option>
            {screens.map((s: any) => (
              <option key={s.id} value={s.id}>{s.genotypingScreen}</option>
            ))}
          </select>
          <select
            value={labFilter}
            onChange={e => setLabFilter(e.target.value)}
            className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
          >
            <option value="">All Labs</option>
            {labs.map((l: any) => (
              <option key={l.id} value={l.id}>{l.labName}</option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
          <div ref={scrollRef} className="overflow-auto max-h-[calc(100vh-320px)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-card border-b shadow-[0_2px_4px_-1px_rgba(0,0,0,0.06)]">
                  {isEditing && <th className="px-2 py-2.5 text-center w-10"></th>}
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Berry</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Genotyping Screen</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Lab</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Year</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">Sample Price</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={isEditing ? 7 : 6} className="px-4 py-12 text-center text-muted-foreground">
                      No data available.
                    </td>
                  </tr>
                ) : (
                  displayRows.map((row, idx) => (
                    <tr key={row.id ?? `new-${idx}`} className="border-b last:border-b-0 hover:bg-muted/20">
                      {isEditing && (
                        <td className="px-2 py-1.5 text-center">
                          {row.isNew ? (
                            <button onClick={() => removeRow(idx)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button onClick={() => { if (row.id) handleDelete(row.id, idx); }} className="p-1 rounded hover:bg-destructive/10 text-destructive">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      )}
                      {isEditing ? (
                        <>
                          <td className="px-2 py-1.5">
                            <select value={row.berryId} onChange={e => updateRow(idx, 'berryId', e.target.value ? parseInt(e.target.value) : '')} className={selectClass}>
                              <option value="">Select...</option>
                              {berries.map((b: any) => <option key={b.id} value={b.id}>{b.berryType}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={row.genotypeScreenId} onChange={e => updateRow(idx, 'genotypeScreenId', e.target.value ? parseInt(e.target.value) : '')} className={selectClass}>
                              <option value="">Select...</option>
                              {screens.map((s: any) => <option key={s.id} value={s.id}>{s.genotypingScreen}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={row.ghLabId} onChange={e => updateRow(idx, 'ghLabId', e.target.value ? parseInt(e.target.value) : '')} className={selectClass}>
                              <option value="">Select...</option>
                              {labs.map((l: any) => <option key={l.id} value={l.id}>{l.labName}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" value={row.year} onChange={e => updateRow(idx, 'year', e.target.value ? parseInt(e.target.value) : '')} className={inputClass} placeholder="Year" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" step="any" value={row.samplePrice} onChange={e => updateRow(idx, 'samplePrice', e.target.value ? parseFloat(e.target.value) : '')} className={inputClass} />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2.5">{row.id != null ? (serverRows.find(r => r.id === row.id)?.berry ?? '') : ''}</td>
                          <td className="px-3 py-2.5">{row.id != null ? (serverRows.find(r => r.id === row.id)?.genotypingScreen ?? '') : ''}</td>
                          <td className="px-3 py-2.5">{row.id != null ? (serverRows.find(r => r.id === row.id)?.lab ?? '') : ''}</td>
                          <td className="px-3 py-2.5">{row.year}</td>
                          <td className="px-3 py-2.5 text-right">{row.samplePrice !== '' ? `$${Number(row.samplePrice).toFixed(2)}` : ''}</td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!isEditing && allDisplayRows.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-secondary/5">
              <div className="text-sm text-muted-foreground">
                Auto-fit: {pageSize} rows per page
              </div>

              <div className="flex items-center gap-1 text-sm">
                <span className="text-muted-foreground mr-4">
                  Showing {Math.min((safePage - 1) * pageSize + 1, allDisplayRows.length)} to {Math.min(safePage * pageSize, allDisplayRows.length)} of {allDisplayRows.length} entries
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="h-8 w-8 p-0"
                >
                  &lt;
                </Button>
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground font-medium">
                  {safePage}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={safePage >= totalPages}
                  className="h-8 w-8 p-0"
                >
                  &gt;
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
