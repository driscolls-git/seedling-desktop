import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  useListMarkerBudgets,
  useCreateMarkerBudget,
  useUpdateMarkerBudget,
  useDeleteMarkerBudget,
  useListBerries,
  useListPrograms,
  useListLabs,
  useListTeams,
  MarkerBudget,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Plus, Save, Trash2, RotateCcw, X, Copy } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

type EditableRow = {
  id: number | null;
  markerSampleAllocationTotal: number | '';
  markerCostAllocationTotal: number | '';
  pollinationYear: number | '';
  berryId: number | '';
  programId: number | '';
  ghLabId: number | '';
  ghTeamId: number | '';
  isNew?: boolean;
  isDirty?: boolean;
};

function toEditable(row: MarkerBudget): EditableRow {
  return {
    id: row.id,
    markerSampleAllocationTotal: row.markerSampleAllocationTotal ?? '',
    markerCostAllocationTotal: row.markerCostAllocationTotal ?? '',
    pollinationYear: row.pollinationYear ?? '',
    berryId: row.berryId ?? '',
    programId: row.programId ?? '',
    ghLabId: row.ghLabId ?? '',
    ghTeamId: row.ghTeamId ?? '',
  };
}

const emptyRow: EditableRow = {
  id: null,
  markerSampleAllocationTotal: '',
  markerCostAllocationTotal: '',
  pollinationYear: '',
  berryId: '',
  programId: '',
  ghLabId: '',
  ghTeamId: '',
  isNew: true,
  isDirty: true,
};

export default function MarkerBudgetPage() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const { isMolecular } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [programFilter, setProgramFilter] = useState('');
  const [labFilter, setLabFilter] = useState('');

  const queryParams = {
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    ...(programFilter ? { programId: parseInt(programFilter) } : {}),
    ...(labFilter ? { labId: parseInt(labFilter) } : {}),
    active: true as const,
  };

  const { data: budgetsData } = useListMarkerBudgets(queryParams);
  const { data: berriesData } = useListBerries();
  const { data: programsData } = useListPrograms({ berryId: filters.berryId, active: true });
  const { data: labsData } = useListLabs();
  const { data: teamsData } = useListTeams();

  const createMutation = useCreateMarkerBudget();
  const updateMutation = useUpdateMarkerBudget();
  const deleteMutation = useDeleteMarkerBudget();

  const [editRows, setEditRows] = useState<EditableRow[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const serverRows = useMemo(() => (budgetsData || []) as MarkerBudget[], [budgetsData]);

  // Pagination (read-only mode only — edit mode keeps showing all rows).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const allDisplayRows = isEditing ? editRows : serverRows.map(toEditable);
  const totalPages = Math.max(1, Math.ceil(allDisplayRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const displayRows = isEditing
    ? allDisplayRows
    : allDisplayRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Clamp page when the filtered row count shrinks.
  useEffect(() => {
    setPage(p => Math.min(p, Math.max(1, Math.ceil(allDisplayRows.length / pageSize))));
  }, [allDisplayRows.length, pageSize]);

  // Auto-fit page size to viewport (matches the DataTable component's behavior).
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

  const startEditing = () => {
    setEditRows(serverRows.map(toEditable));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setEditRows([]);
    setIsEditing(false);
  };

  const addRow = () => {
    setEditRows(prev => [...prev, { ...emptyRow, pollinationYear: filters.pollinationYear || '' }]);
  };

  const updateRow = (index: number, field: keyof EditableRow, value: number | '') => {
    setEditRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value, isDirty: true } : r));
  };

  const removeRow = (index: number) => {
    setEditRows(prev => prev.filter((_, i) => i !== index));
  };

  const isRowValid = (row: EditableRow) =>
    row.markerSampleAllocationTotal !== '' &&
    row.markerCostAllocationTotal !== '' &&
    row.pollinationYear !== '' &&
    row.berryId !== '' &&
    row.programId !== '' &&
    row.ghLabId !== '' &&
    row.ghTeamId !== '';

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
          markerSampleAllocationTotal: Number(row.markerSampleAllocationTotal),
          markerCostAllocationTotal: Number(row.markerCostAllocationTotal),
          pollinationYear: Number(row.pollinationYear),
          berryId: Number(row.berryId),
          programId: Number(row.programId),
          ghLabId: Number(row.ghLabId),
          ghTeamId: Number(row.ghTeamId),
        };

        if (row.isNew) {
          await createMutation.mutateAsync({ data: payload });
        } else {
          await updateMutation.mutateAsync({ id: row.id!, data: payload });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['/api/marker-budgets'] });
      toast({ title: 'Saved', description: 'Marker allocations saved successfully.' });
      setIsEditing(false);
      setEditRows([]);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string }; response?: { data?: { message?: string } }; message?: string };
      const msg =
        err?.data?.message ||
        err?.response?.data?.message ||
        err?.message?.match(/:\s*(.+)$/)?.[1] ||
        err?.message ||
        'Failed to save marker allocations.';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/marker-budgets'] });
      toast({ title: 'Deleted', description: 'Marker allocation deleted.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete.', variant: 'destructive' });
    }
  };

  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const currentYearRows = serverRows.filter(r => r.pollinationYear === currentYear);

  const copyToNextYear = async () => {
    setIsCopying(true);
    try {
      let created = 0;
      for (const row of currentYearRows) {
        await createMutation.mutateAsync({
          data: {
            markerSampleAllocationTotal: row.markerSampleAllocationTotal ?? 0,
            markerCostAllocationTotal: row.markerCostAllocationTotal ?? 0,
            pollinationYear: nextYear,
            berryId: row.berryId!,
            programId: row.programId!,
            ghLabId: row.ghLabId!,
            ghTeamId: row.ghTeamId!,
          },
        });
        created++;
      }
      queryClient.invalidateQueries({ queryKey: ['/api/marker-budgets'] });
      toast({ title: 'Copied', description: `${created} allocation row${created !== 1 ? 's' : ''} copied from ${currentYear} to ${nextYear}.` });
      setShowCopyConfirm(false);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string }; response?: { data?: { message?: string } }; message?: string };
      const msg =
        err?.data?.message ||
        err?.response?.data?.message ||
        err?.message?.match(/:\s*(.+)$/)?.[1] ||
        err?.message ||
        'Failed to copy allocations to next year.';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setIsCopying(false);
    }
  };

  const resetFilters = () => {
    setProgramFilter('');
    setLabFilter('');
    setPage(1);
  };

  const berries = useMemo(() => berriesData || [], [berriesData]);
  const programs = useMemo(() => programsData || [], [programsData]);
  const labs = useMemo(() => labsData || [], [labsData]);
  const teams = useMemo(() => teamsData || [], [teamsData]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const selectClass = "w-full border rounded px-2 py-1 text-sm bg-background focus:ring-1 focus:ring-primary outline-none";
  const inputClass = "w-full border rounded px-2 py-1 text-sm bg-background text-right focus:ring-1 focus:ring-primary outline-none";

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('reference.markerBudget.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('reference.markerBudget.description')}</p>
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
                <>
                  <Button size="sm" variant="outline" onClick={() => setShowCopyConfirm(true)} disabled={currentYearRows.length === 0} className="gap-1.5 rounded-lg">
                    <Copy className="w-3.5 h-3.5" /> Copy {currentYear} → {nextYear}
                  </Button>
                  <Button size="sm" onClick={startEditing} className="gap-1.5 rounded-lg">
                    Edit
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <select
            value={programFilter}
            onChange={e => setProgramFilter(e.target.value)}
            className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
          >
            <option value="">All Programs</option>
            {programs.map((p: any) => (
              <option key={p.id} value={p.id}>{p.srcBreedingProgram}</option>
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
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Program</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Lab</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Team</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Pollination Year</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">Sample Allocation Total</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">Cost Allocation Total</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={isEditing ? 9 : 8} className="px-4 py-12 text-center text-muted-foreground">
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
                            <button onClick={() => { if (row.id) handleDelete(row.id); }} className="p-1 rounded hover:bg-destructive/10 text-destructive">
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
                            <select value={row.programId} onChange={e => updateRow(idx, 'programId', e.target.value ? parseInt(e.target.value) : '')} className={selectClass}>
                              <option value="">Select...</option>
                              {programs.map((p: any) => <option key={p.id} value={p.id}>{p.srcBreedingProgram}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={row.ghLabId} onChange={e => updateRow(idx, 'ghLabId', e.target.value ? parseInt(e.target.value) : '')} className={selectClass}>
                              <option value="">Select...</option>
                              {labs.map((l: any) => <option key={l.id} value={l.id}>{l.labName}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={row.ghTeamId} onChange={e => updateRow(idx, 'ghTeamId', e.target.value ? parseInt(e.target.value) : '')} className={selectClass}>
                              <option value="">Select...</option>
                              {teams.map((t: any) => <option key={t.id} value={t.id}>{t.teamName}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" value={row.pollinationYear} onChange={e => updateRow(idx, 'pollinationYear', e.target.value ? parseInt(e.target.value) : '')} className={inputClass} placeholder="Year" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" step="any" value={row.markerSampleAllocationTotal} onChange={e => updateRow(idx, 'markerSampleAllocationTotal', e.target.value ? parseFloat(e.target.value) : '')} className={inputClass} />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" step="any" value={row.markerCostAllocationTotal} onChange={e => updateRow(idx, 'markerCostAllocationTotal', e.target.value ? parseFloat(e.target.value) : '')} className={inputClass} />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2.5">{row.id != null ? (serverRows.find(r => r.id === row.id)?.berryType ?? '') : ''}</td>
                          <td className="px-3 py-2.5">{row.id != null ? (serverRows.find(r => r.id === row.id)?.srcBreedingProgram ?? '') : ''}</td>
                          <td className="px-3 py-2.5">{row.id != null ? (serverRows.find(r => r.id === row.id)?.ghLabName ?? '') : ''}</td>
                          <td className="px-3 py-2.5">{row.id != null ? (serverRows.find(r => r.id === row.id)?.ghTeamName ?? '') : ''}</td>
                          <td className="px-3 py-2.5">{row.pollinationYear}</td>
                          <td className="px-3 py-2.5 text-right">{row.markerSampleAllocationTotal !== '' ? formatNumber(row.markerSampleAllocationTotal) : ''}</td>
                          <td className="px-3 py-2.5 text-right">{row.markerCostAllocationTotal !== '' ? formatNumber(row.markerCostAllocationTotal) : ''}</td>
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

      {showCopyConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !isCopying && setShowCopyConfirm(false)}>
          <div className="bg-card rounded-2xl border shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-2">Copy Allocations to {nextYear}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will duplicate <strong>{currentYearRows.length}</strong> allocation row{currentYearRows.length !== 1 ? 's' : ''} from
              pollination year <strong>{currentYear}</strong> to <strong>{nextYear}</strong> with the same values.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowCopyConfirm(false)} disabled={isCopying}>Cancel</Button>
              <Button onClick={copyToNextYear} disabled={isCopying} className="gap-1.5">
                <Copy className="w-3.5 h-3.5" />
                {isCopying ? 'Copying...' : `Copy ${currentYearRows.length} Row${currentYearRows.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
