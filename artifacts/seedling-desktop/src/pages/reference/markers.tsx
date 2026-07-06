import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FilterContext';
import {
  useListMarkers,
  useCreateMarker,
  useUpdateMarker,
  useDeleteMarker,
  useListBerries,
  useListLabs,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, X, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

type MarkerFormData = {
  traitMarker: string;
  berryId: number | null;
  preferredLabId: number | null;
  markerAliasDriscolls: string;
  markerAliasCorteva: string;
  cortevaLabStatus: string;
  lgcLabStatus: string;
  active: boolean;
};

const emptyForm: MarkerFormData = {
  traitMarker: '',
  berryId: null,
  preferredLabId: null,
  markerAliasDriscolls: '',
  markerAliasCorteva: '',
  cortevaLabStatus: '',
  lgcLabStatus: '',
  active: true,
};

export default function MarkersPage() {
  const { t } = useTranslation();
  const { isMolecular } = useAuth();
  const { filters } = useFilters();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeFilter, setActiveFilter] = useState('true');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MarkerFormData>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);

  const queryParams: Record<string, any> = {};
  if (activeFilter) queryParams.active = activeFilter === 'true';
  if (filters.berryId) queryParams.berryId = filters.berryId;

  const { data: allMarkers = [] } = useListMarkers(queryParams);
  const { data: berries = [] } = useListBerries();
  const { data: labs = [] } = useListLabs();
  const createMutation = useCreateMarker();
  const updateMutation = useUpdateMarker();
  const deleteMutation = useDeleteMarker();

  const columns: ColumnDef<any>[] = useMemo(() => {
    const cols: ColumnDef<any>[] = [
      { key: 'berryType', header: 'Berry', width: 'w-20' },
      { key: 'traitMarker', header: 'Trait / Marker', width: 'w-56' },
      { key: 'preferredLabName', header: 'Preferred Lab', width: 'w-28' },
      { key: 'markerAliasDriscolls', header: 'Alias (Driscolls)', width: 'w-36' },
      { key: 'markerAliasCorteva', header: 'Alias (Corteva)', width: 'w-36' },
      { key: 'cortevaLabStatus', header: 'Corteva Status', width: 'w-28' },
      { key: 'lgcLabStatus', header: 'LGC Status', width: 'w-28' },
      { key: 'active', header: 'Active', width: 'w-16', render: (row) => row.active ? 'Yes' : 'No' },
    ];
    if (isMolecular) {
      cols.unshift({
        key: 'id', header: 'Actions', width: 'w-20',
        render: (row) => (
          <div className="flex gap-1">
            <button onClick={e => { e.stopPropagation(); setEditingId(row.id); setForm({ traitMarker: row.traitMarker ?? '', berryId: row.berryId ?? null, preferredLabId: row.preferredLabId ?? null, markerAliasDriscolls: row.markerAliasDriscolls ?? '', markerAliasCorteva: row.markerAliasCorteva ?? '', cortevaLabStatus: row.cortevaLabStatus ?? '', lgcLabStatus: row.lgcLabStatus ?? '', active: row.active ?? true }); setFormOpen(true); }} className="p-1 rounded hover:bg-primary/10 text-primary" title={t('common.edit')}><Pencil size={15} /></button>
            {row.active !== false && <button onClick={e => { e.stopPropagation(); setDeleteConfirm(row); }} className="p-1 rounded hover:bg-destructive/10 text-destructive" title="Inactivate"><Trash2 size={15} /></button>}
          </div>
        ),
      });
    }
    return cols;
  }, [isMolecular]);

  const handleFormSave = async () => {
    if (!form.traitMarker.trim()) { toast({ title: 'Validation Error', description: 'Trait / Marker is required.', variant: 'destructive' }); return; }
    if (!form.berryId) { toast({ title: 'Validation Error', description: 'Berry is required.', variant: 'destructive' }); return; }
    if (!form.preferredLabId) { toast({ title: 'Validation Error', description: 'Preferred Lab is required.', variant: 'destructive' }); return; }
    if (!form.markerAliasDriscolls.trim()) { toast({ title: 'Validation Error', description: 'Alias (Driscolls) is required.', variant: 'destructive' }); return; }
    const payload = {
      traitMarker: form.traitMarker.trim(),
      berryId: form.berryId ?? undefined,
      preferredLabId: form.preferredLabId ?? undefined,
      markerAliasDriscolls: form.markerAliasDriscolls || undefined,
      markerAliasCorteva: form.markerAliasCorteva || undefined,
      cortevaLabStatus: form.cortevaLabStatus || undefined,
      lgcLabStatus: form.lgcLabStatus || undefined,
      active: form.active,
    };
    try {
      if (editingId) { await updateMutation.mutateAsync({ id: editingId, data: payload }); toast({ title: 'Updated', description: 'Marker updated.' }); }
      else { await createMutation.mutateAsync({ data: payload }); toast({ title: 'Created', description: 'Marker created.' }); }
      queryClient.invalidateQueries({ queryKey: ['/api/markers'] });
      setFormOpen(false);
    } catch { toast({ title: 'Error', description: 'Failed to save marker.', variant: 'destructive' }); }
  };

  const handleInactivate = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteConfirm.id });
      toast({ title: 'Inactivated', description: 'Marker inactivated.' });
      queryClient.invalidateQueries({ queryKey: ['/api/markers'] });
      setDeleteConfirm(null);
    } catch { toast({ title: 'Error', description: 'Failed to inactivate marker.', variant: 'destructive' }); }
  };

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => { setActiveFilter('true'); setResetPageSignal(s => s + 1); };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('reference.markers.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('reference.markers.description')}</p>
          </div>
          {isMolecular && (
            <Button size="sm" onClick={() => { setEditingId(null); setForm(emptyForm); setFormOpen(true); }} className="gap-1.5 rounded-lg">
              <Plus className="w-3.5 h-3.5" /> New Marker
            </Button>
          )}
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <select
            value={activeFilter}
            onChange={e => setActiveFilter(e.target.value)}
            className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
          >
            <option value="true">Active Only</option>
            <option value="false">Inactive Only</option>
            <option value="">All</option>
          </select>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal} data={allMarkers} columns={columns} title="Marker List" />

        {formOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{editingId ? 'Edit Marker' : 'New Marker'}</h2>
                <button onClick={() => setFormOpen(false)} className="p-1 rounded hover:bg-muted"><X size={18} /></button>
              </div>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Trait / Marker *</label>
                  <input type="text" value={form.traitMarker} onChange={e => setForm(p => ({ ...p, traitMarker: e.target.value }))} className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Berry *</label>
                    <select value={form.berryId ?? ''} onChange={e => setForm(p => ({ ...p, berryId: e.target.value === '' ? null : parseInt(e.target.value) }))} className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none">
                      <option value="">-- Select --</option>
                      {berries.map(b => <option key={b.id} value={b.id}>{b.berryType}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Preferred Lab *</label>
                    <select value={form.preferredLabId ?? ''} onChange={e => setForm(p => ({ ...p, preferredLabId: e.target.value === '' ? null : parseInt(e.target.value) }))} className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none">
                      <option value="">-- Select --</option>
                      {labs.map((l: any) => <option key={l.id} value={l.id}>{l.labName}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Alias (Driscolls) *</label>
                  <input type="text" value={form.markerAliasDriscolls} onChange={e => setForm(p => ({ ...p, markerAliasDriscolls: e.target.value }))} className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Alias (Corteva)</label>
                  <input type="text" value={form.markerAliasCorteva} onChange={e => setForm(p => ({ ...p, markerAliasCorteva: e.target.value }))} className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Corteva Lab Status</label>
                    <input type="text" value={form.cortevaLabStatus} onChange={e => setForm(p => ({ ...p, cortevaLabStatus: e.target.value }))} className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">LGC Lab Status</label>
                    <input type="text" value={form.lgcLabStatus} onChange={e => setForm(p => ({ ...p, lgcLabStatus: e.target.value }))} className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Active</label>
                  <select value={form.active ? 'true' : 'false'} onChange={e => setForm(p => ({ ...p, active: e.target.value === 'true' }))} className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none">
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={handleFormSave}>{editingId ? 'Update' : 'Create'}</Button>
              </div>
            </div>
          </div>
        )}

        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <h2 className="text-lg font-semibold">Inactivate Marker</h2>
              <p className="text-sm text-muted-foreground">Are you sure you want to inactivate <strong>{deleteConfirm.traitMarker}</strong>?</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                <Button size="sm" variant="destructive" onClick={handleInactivate}>Inactivate</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
