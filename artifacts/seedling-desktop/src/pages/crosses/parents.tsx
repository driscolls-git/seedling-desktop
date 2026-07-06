import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import {
  useListParents, useCreateParent, useUpdateParent, useDeleteParent,
  useListBerries, useListTeams, useListSelections,
  Parent, ParentInput,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Trash2, X, Save, Loader2, Columns, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/use-debounce';
import { useToast } from '@/hooks/use-toast';

interface ParentFormState {
  open: boolean;
  editId?: number;
  data: Partial<ParentInput>;
}

function SearchableSelect({
  value, onChange, options, placeholder, disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return options.slice(0, 50);
    const lower = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(lower)).slice(0, 50);
  }, [options, search]);

  return (
    <div className="relative">
      <input
        type="text"
        value={open ? search : value || ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setSearch(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className={`w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-1 focus:ring-primary outline-none ${disabled ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''}`}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-card border rounded-lg shadow-lg">
          {filtered.map(o => (
            <button
              key={o.value}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-primary/5 transition-colors"
              onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ParentDialog({
  state,
  onClose,
  onSave,
  berries,
  teams,
  selectionOptions,
  isSaving,
}: {
  state: ParentFormState;
  onClose: () => void;
  onSave: (data: ParentInput) => void;
  berries: { id: number; berryType: string }[];
  teams: { id: number; teamName: string }[];
  selectionOptions: { value: string; label: string; berry?: string | null }[];
  isSaving: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Partial<ParentInput>>(state.data);

  useEffect(() => { setForm(state.data); }, [state.data]);

  // Restrict the Selection dropdown to entries whose berry matches the form's
  // chosen berry.  This enforces the master-data rule client-side so the user
  // can only pick a valid (selection, berry) pair.
  const selectedBerryName = useMemo(
    () => berries.find(b => b.id === form.berryId)?.berryType ?? null,
    [berries, form.berryId],
  );
  const filteredSelectionOptions = useMemo(() => {
    if (!selectedBerryName) return [];
    return selectionOptions.filter(o => !o.berry || o.berry === selectedBerryName);
  }, [selectionOptions, selectedBerryName]);

  // If the user changes berry to one where the current selection is invalid,
  // clear the selection so they consciously pick a new one.
  useEffect(() => {
    if (state.editId) return; // edit dialog locks selection anyway
    if (!form.selection || !selectedBerryName) return;
    const stillValid = selectionOptions.some(o => o.value === form.selection && (!o.berry || o.berry === selectedBerryName));
    if (!stillValid) setForm(f => ({ ...f, selection: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBerryName]);

  if (!state.open) return null;

  const update = (key: keyof ParentInput, val: any) => setForm(f => ({ ...f, [key]: val }));
  const inp = "w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-1 focus:ring-primary outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card rounded-2xl border shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-lg">{state.editId ? 'Edit Parent' : 'Add Parent'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary/20"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Selection *</label>
              {state.editId ? (
                <input type="text" value={form.selection || ''} readOnly className={inp + " bg-muted cursor-not-allowed"} />
              ) : (
                <>
                  <SearchableSelect
                    value={form.selection || ''}
                    onChange={v => update('selection', v)}
                    options={filteredSelectionOptions}
                    placeholder={selectedBerryName ? t('common.typeToSearch') : 'Pick a berry first'}
                    disabled={!selectedBerryName}
                  />
                  {!selectedBerryName && (
                    <p className="mt-1 text-xs text-muted-foreground">Select a berry to see valid Selections.</p>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Berry *</label>
              <select value={form.berryId ?? ''} onChange={e => update('berryId', Number(e.target.value))} className={inp}>
                <option value="">Select berry...</option>
                {berries.map(b => <option key={b.id} value={b.id}>{b.berryType}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Team *</label>
              <select value={form.teamId ?? ''} onChange={e => update('teamId', Number(e.target.value))} className={inp}>
                <option value="">Select team...</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.teamName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Pollination Year *</label>
              <input type="number" value={form.pollinationYear ?? ''} onChange={e => update('pollinationYear', e.target.value ? Number(e.target.value) : undefined)} className={inp} />
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Locations</h4>
            <div className="grid grid-cols-4 gap-3">
              {([1, 2, 3, 4] as const).map(n => (
                <React.Fragment key={n}>
                  <div className="col-span-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">L{n} Field Code/GH Zone</label>
                      <input type="text" value={(form as any)[`l${n}fc`] ?? ''} onChange={e => update(`l${n}fc` as keyof ParentInput, e.target.value || undefined)} className={inp} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">L{n} Row.Pos/Table#</label>
                      <input type="text" value={(form as any)[`l${n}`] ?? ''} onChange={e => update(`l${n}` as keyof ParentInput, e.target.value || undefined)} className={inp} />
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Total Parents *</label>
              <input type="number" min={1} value={form.totalParents ?? ''} onChange={e => update('totalParents', e.target.value ? Number(e.target.value) : undefined)} className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Comments</label>
              <input type="text" value={form.comments ?? ''} onChange={e => update('comments', e.target.value || undefined)} className={inp} />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!form.spCrosses} onChange={e => update('spCrosses', e.target.checked)} className="rounded" />
              <span className="text-sm">SP Crosses</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!form.firstYrParent} onChange={e => update('firstYrParent', e.target.checked)} className="rounded" />
              <span className="text-sm">First Year Parent</span>
            </label>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 p-5 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form as ParentInput)} disabled={isSaving || !form.selection || !form.berryId || !form.teamId || !form.pollinationYear || form.totalParents == null || form.totalParents <= 0}>
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            {state.editId ? 'Save Changes' : 'Add Parent'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ParentsList() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const queryClient = useQueryClient();
  const { isBreeder, canEditCrosses, user } = useAuth();
  const canInactivate = user?.userLevelFk === 2;
  const [search, setSearch] = useState('');
  const [fcSearch, setFcSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Parent | null>(null);
  const [showL2L4, setShowL2L4] = useState(false);
  const debouncedSearch = useDebounce(search);
  const debouncedFcSearch = useDebounce(fcSearch);
  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setSearch('');
    setFcSearch('');
    setResetPageSignal(s => s + 1);
  };

  const [parentForm, setParentForm] = useState<ParentFormState>({
    open: false,
    data: { pollinationYear: new Date().getFullYear() },
  });

  const { data: parents, isLoading } = useListParents({
    berryId: filters.berryId,
    teamId: filters.teamId,
    pollinationYear: filters.pollinationYear,
    spCrosses: filters.spCrosses,
    selection: debouncedSearch || undefined,
  });

  const { data: berries } = useListBerries();
  const { data: teams } = useListTeams();
  const { data: selections } = useListSelections({ active: true });

  const selectionOptions = useMemo(() =>
    (selections || []).map(s => ({
      value: s.selection,
      label: s.selection,
      // Carry the berry through so the dialog can filter to the chosen berry.
      berry: (s as any).berry as string | null | undefined,
    })),
    [selections]
  );
  const createParent = useCreateParent();
  const updateParent = useUpdateParent();
  const deleteParent = useDeleteParent();

  const { toast } = useToast();

  const extractErrorMessage = (error: unknown): string => {
    if (error && typeof error === 'object') {
      const err = error as any;
      if (err.data?.message) return err.data.message;
      if (err.response?.data?.message) return err.response.data.message;
      if (err.message) {
        const match = err.message.match(/:\s*(.+)$/);
        return match ? match[1] : err.message;
      }
    }
    return 'An unexpected error occurred.';
  };

  const handleSave = (data: ParentInput) => {
    if (parentForm.editId) {
      updateParent.mutate({ id: parentForm.editId, data }, {
        onSuccess: () => {
          setParentForm({ open: false, data: {} });
          queryClient.invalidateQueries({ queryKey: ['/api/parents'] });
          toast({ title: 'Updated', description: 'Parent updated successfully.' });
        },
        onError: (error) => {
          toast({ title: 'Validation Error', description: extractErrorMessage(error), variant: 'destructive' });
        },
      });
    } else {
      createParent.mutate({ data }, {
        onSuccess: () => {
          setParentForm({ open: false, data: {} });
          queryClient.invalidateQueries({ queryKey: ['/api/parents'] });
          toast({ title: 'Created', description: 'Parent created successfully.' });
        },
        onError: (error) => {
          toast({ title: 'Validation Error', description: extractErrorMessage(error), variant: 'destructive' });
        },
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteParent.mutate({ id: deleteTarget.id }, {
      onSuccess: () => {
        setDeleteTarget(null);
        queryClient.invalidateQueries({ queryKey: ['/api/parents'] });
        toast({ title: 'Deleted', description: 'Parent deleted successfully.' });
      },
      onError: () => {
        toast({ title: 'Error', description: 'Failed to delete parent.', variant: 'destructive' });
      },
    });
  };

  const openEditDialog = (parent: Parent) => {
    setParentForm({
      open: true,
      editId: parent.id,
      data: {
        selection: parent.selection,
        l1fc: parent.l1fc,
        l1: parent.l1,
        l2fc: parent.l2fc,
        l2: parent.l2,
        l3fc: parent.l3fc,
        l3: parent.l3,
        l4fc: parent.l4fc,
        l4: parent.l4,
        totalParents: parent.totalParents,
        pollinationYear: parent.pollinationYear ?? undefined,
        comments: parent.comments,
        berryId: parent.berryId ?? undefined as any,
        teamId: parent.teamId ?? undefined as any,
        spCrosses: parent.spCrosses,
        firstYrParent: parent.firstYrParent,
      },
    });
  };

  const columns: ColumnDef<Parent>[] = [
    ...(canEditCrosses ? [{
      key: '_actions', header: 'Actions', width: 'w-20',
      render: (r: Parent) => (
        <div className="flex items-center gap-1">
          <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); openEditDialog(r); }}
            className="p-1 rounded hover:bg-primary/10 text-primary" title={t('common.edit')}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {canInactivate && (
            <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); setDeleteTarget(r); }}
              className="p-1 rounded hover:bg-destructive/10 text-destructive" title={t('common.delete')}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ),
    } as ColumnDef<Parent>] : []),
    { key: 'selection', header: 'Selection', sticky: true, width: 'w-48' },
    { key: 'l1fc', header: 'L1 FC' },
    { key: 'l1', header: 'L1' },
    { key: 'l2fc', header: 'L2 FC', hidden: !showL2L4 },
    { key: 'l2', header: 'L2', hidden: !showL2L4 },
    { key: 'l3fc', header: 'L3 FC', hidden: !showL2L4 },
    { key: 'l3', header: 'L3', hidden: !showL2L4 },
    { key: 'l4fc', header: 'L4 FC', hidden: !showL2L4 },
    { key: 'l4', header: 'L4', hidden: !showL2L4 },
    { key: 'totalParents', header: 'Total Parents', isNumeric: true, render: (r) => formatNumber(r.totalParents) },
    { key: 'totalParentsRequired', header: 'Parents Required', isNumeric: true, render: (r) => formatNumber((r as any).totalParentsRequired) },
    {
      key: 'parentVariance' as any, header: 'Parent Variance', isNumeric: true,
      render: (r) => formatNumber((r as any).parentVariance),
      cellClassName: (r) => {
        const v = (r as any).parentVariance;
        return typeof v === 'number' && v < 0 ? 'bg-red-50 text-red-700' : '';
      },
    },
    { key: 'pollinationYear', header: 'Year', isNumeric: true },
    { key: 'comments', header: 'Comments' },
    { key: 'berryName', header: 'Berry' },
    { key: 'teamName', header: 'Team' },
    { key: 'spCrosses', header: 'SP Crosses', render: (r) => r.spCrosses ? 'Yes' : 'No' },
    { key: 'firstYrParent', header: 'First Yr', render: (r) => r.firstYrParent ? 'Yes' : 'No' },
  ];

  const rows = useMemo(() => {
    const all = parents || [];
    if (!debouncedFcSearch) return all;
    const lower = debouncedFcSearch.toLowerCase();
    return all.filter(r =>
      (r.l1fc && String(r.l1fc).toLowerCase().includes(lower)) ||
      (r.l2fc && String(r.l2fc).toLowerCase().includes(lower)) ||
      (r.l3fc && String(r.l3fc).toLowerCase().includes(lower)) ||
      (r.l4fc && String(r.l4fc).toLowerCase().includes(lower))
    );
  }, [parents, debouncedFcSearch]);

  const parentTotals = useMemo(() => {
    if (!rows.length) return undefined;
    return {
      totalParents: rows.reduce((s, r) => s + (r.totalParents ?? 0), 0),
      totalParentsRequired: rows.reduce((s, r) => s + ((r as any).totalParentsRequired ?? 0), 0),
    };
  }, [rows]);

  const actionBar = canEditCrosses ? (
    <Button size="sm" onClick={() => setParentForm({ open: true, data: { pollinationYear: filters.pollinationYear, berryId: filters.berryId, teamId: filters.teamId } })} className="gap-1.5 rounded-lg">
      <Plus className="w-3.5 h-3.5" /> Add Parent
    </Button>
  ) : undefined;

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('crosses.parentList')}</h1>
            <p className="text-muted-foreground mt-1">Manage parent plant locations and counts.</p>
          </div>
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-4">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <Input
            placeholder={t('common.typeToSearch')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Input
            placeholder="Field Code / GH Zone..."
            value={fcSearch}
            onChange={(e) => setFcSearch(e.target.value)}
            className="w-64"
          />
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
          <Button
            variant={showL2L4 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowL2L4(v => !v)}
            className="gap-1.5 ml-auto"
          >
            <Columns className="w-3.5 h-3.5" />
            {showL2L4 ? 'Hide' : 'Show'} L2FC–L4
          </Button>
        </div>

        <DataTable
          title="Inventory"
          data={rows}
          columns={columns}
          totals={parentTotals as Partial<Record<string, number>> | undefined}
          isLoading={isLoading}
          actionBar={actionBar}
          resetPageSignal={resetPageSignal}
          rowClassName={(r: any) => typeof r.parentVariance === 'number' && r.parentVariance < 0 ? 'bg-red-50 even:bg-red-50 hover:bg-red-100' : undefined}
        />
      </div>

      <ParentDialog
        state={parentForm}
        onClose={() => setParentForm({ open: false, data: {} })}
        onSave={handleSave}
        berries={(berries || [])}
        teams={(teams || []) as any}
        selectionOptions={selectionOptions}
        isSaving={createParent.isPending || updateParent.isPending}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteTarget(null)}>
          <div className="bg-card rounded-2xl border shadow-xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-2">Delete Parent</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to delete parent record <strong>{deleteTarget.selection}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteParent.isPending}>
                {deleteParent.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
