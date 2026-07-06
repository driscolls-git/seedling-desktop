import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useAuth } from '@/contexts/AuthContext';
import {
  useListTeams,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, X, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

type TeamFormData = {
  teamName: string;
  active: boolean;
};

const emptyForm: TeamFormData = { teamName: '', active: true };

export default function TeamsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeFilter, setActiveFilter] = useState('true');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TeamFormData>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);

  const queryParams: Record<string, any> = {};
  if (activeFilter) queryParams.active = activeFilter === 'true';

  const { data: teams = [] } = useListTeams(queryParams);
  const createMutation = useCreateTeam();
  const updateMutation = useUpdateTeam();
  const deleteMutation = useDeleteTeam();

  const columns: ColumnDef<any>[] = useMemo(() => {
    const cols: ColumnDef<any>[] = [
      { key: 'teamName', header: 'Team Name', width: 'w-48' },
      { key: 'active', header: 'Active', width: 'w-20', render: (row) => row.active ? 'Yes' : 'No' },
      { key: 'modifiedDate', header: 'Modified', width: 'w-28' },
      { key: 'modifiedBy', header: 'Modified By', width: 'w-28' },
    ];
    if (isAdmin) {
      cols.unshift({
        key: 'id', header: 'Actions', width: 'w-20',
        render: (row) => (
          <div className="flex gap-1">
            <button onClick={e => { e.stopPropagation(); setEditingId(row.id); setForm({ teamName: row.teamName, active: row.active }); setFormOpen(true); }} className="p-1 rounded hover:bg-primary/10 text-primary" title={t('common.edit')}><Pencil size={15} /></button>
            {row.active && <button onClick={e => { e.stopPropagation(); setDeleteConfirm(row); }} className="p-1 rounded hover:bg-destructive/10 text-destructive" title="Inactivate"><Trash2 size={15} /></button>}
          </div>
        ),
      });
    }
    return cols;
  }, [isAdmin]);

  const handleFormSave = async () => {
    if (!form.teamName.trim()) { toast({ title: 'Validation Error', description: 'Team Name is required.', variant: 'destructive' }); return; }
    const payload = { teamName: form.teamName.trim(), active: form.active };
    try {
      if (editingId) { await updateMutation.mutateAsync({ id: editingId, data: payload }); toast({ title: 'Updated', description: 'Team updated.' }); }
      else { await createMutation.mutateAsync({ data: payload }); toast({ title: 'Created', description: 'Team created.' }); }
      queryClient.invalidateQueries({ queryKey: ['/api/teams'] });
      setFormOpen(false);
    } catch { toast({ title: 'Error', description: 'Failed to save team.', variant: 'destructive' }); }
  };

  const handleInactivate = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteConfirm.id });
      toast({ title: 'Inactivated', description: 'Team inactivated.' });
      queryClient.invalidateQueries({ queryKey: ['/api/teams'] });
      setDeleteConfirm(null);
    } catch { toast({ title: 'Error', description: 'Failed to inactivate team.', variant: 'destructive' }); }
  };

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => { setActiveFilter('true'); setResetPageSignal(s => s + 1); };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('reference.teams.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('reference.teams.description')}</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => { setEditingId(null); setForm(emptyForm); setFormOpen(true); }} className="gap-1.5 rounded-lg">
              <Plus className="w-3.5 h-3.5" /> New Team
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
          resetPageSignal={resetPageSignal} data={teams} columns={columns} title="Teams" />

        {formOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{editingId ? 'Edit Team' : 'New Team'}</h2>
                <button onClick={() => setFormOpen(false)} className="p-1 rounded hover:bg-muted"><X size={18} /></button>
              </div>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Team Name *</label>
                  <input type="text" value={form.teamName} onChange={e => setForm(p => ({ ...p, teamName: e.target.value }))} className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none" />
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
              <h2 className="text-lg font-semibold">Inactivate Team</h2>
              <p className="text-sm text-muted-foreground">Are you sure you want to inactivate <strong>{deleteConfirm.teamName}</strong>?</p>
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
