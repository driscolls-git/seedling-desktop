import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FilterContext';
import {
  useListEmployees,
  useCreateEmployee,
  useUpdateEmployee,
  useDeleteEmployee,
  useListTeams,
  Employee,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, X, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/use-debounce';

type EmployeeFormData = {
  ghEmployee: string;
  employeeNum: number | null;
  teamId: number | null;
  userLevelFk: number | null;
  email: string;
  active: boolean;
};

const emptyForm: EmployeeFormData = {
  ghEmployee: '',
  employeeNum: null,
  teamId: null,
  userLevelFk: 1,
  email: '',
  active: true,
};

function employeeToForm(e: Employee): EmployeeFormData {
  return {
    ghEmployee: e.ghEmployee ?? '',
    employeeNum: e.employeeNum ?? null,
    teamId: e.teamId ?? null,
    userLevelFk: e.userLevelFk ?? 1,
    email: e.email ?? '',
    active: e.active ?? true,
  };
}

const USER_LEVELS = [
  { value: 1, label: '1 - User' },
  { value: 2, label: '2 - Breeder' },
  { value: 3, label: '3 - Admin2' },
  { value: 4, label: '4 - Admin3' },
  { value: 5, label: '5 - Molecular' },
];

export default function EmployeesPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const { filters } = useFilters();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [nameSearch, setNameSearch] = useState('');
  const [userLevelFilter, setUserLevelFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('true');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<EmployeeFormData>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<Employee | null>(null);

  const debouncedName = useDebounce(nameSearch);

  const queryParams: Record<string, any> = {};
  if (activeFilter) queryParams.active = activeFilter === 'true';
  if (filters.teamId) queryParams.teamId = filters.teamId;
  if (debouncedName) queryParams.name = debouncedName;
  if (userLevelFilter) queryParams.userLevelFk = parseInt(userLevelFilter);

  const { data: employees = [] } = useListEmployees(queryParams);
  const { data: allTeams = [] } = useListTeams();
  const createMutation = useCreateEmployee();
  const updateMutation = useUpdateEmployee();
  const deleteMutation = useDeleteEmployee();

  const columns: ColumnDef<Employee>[] = useMemo(() => {
    const cols: ColumnDef<Employee>[] = [
      { key: 'ghEmployee', header: 'Employee Name', width: 'w-48' },
      { key: 'employeeNum', header: 'Employee #', width: 'w-24', render: (row) => isAdmin ? String(row.employeeNum ?? '') : '••••' },
      { key: 'teamName', header: 'Team', width: 'w-36' },
      { key: 'email', header: 'Email', width: 'w-52' },
      {
        key: 'userLevelFk',
        header: 'User Level',
        width: 'w-28',
        render: (row) => {
          const level = USER_LEVELS.find(l => l.value === row.userLevelFk);
          return level ? level.label : String(row.userLevelFk ?? '');
        },
      },
      {
        key: 'active',
        header: 'Active',
        width: 'w-20',
        render: (row) => row.active ? 'Yes' : 'No',
      },
      { key: 'modifiedDate', header: 'Modified', width: 'w-28' },
      { key: 'modifiedBy', header: 'Modified By', width: 'w-28' },
    ];
    if (isAdmin) {
      cols.unshift({
        key: 'id',
        header: 'Actions',
        width: 'w-20',
        render: (row) => (
          <div className="flex gap-1">
            <button
              onClick={e => { e.stopPropagation(); handleEdit(row); }}
              className="p-1 rounded hover:bg-primary/10 text-primary"
              title={t('common.edit')}
            >
              <Pencil size={15} />
            </button>
            {row.active !== false && (
              <button
                onClick={e => { e.stopPropagation(); setDeleteConfirm(row); }}
                className="p-1 rounded hover:bg-destructive/10 text-destructive"
                title="Inactivate"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ),
      });
    }
    return cols;
  }, [isAdmin]);

  const handleEdit = (row: Employee) => {
    setEditingId(row.id);
    setForm(employeeToForm(row));
    setFormOpen(true);
  };

  const handleNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const isEmployeeNumValid = (n: number | null): boolean =>
    n != null && Number.isInteger(n) && n >= 1000 && n <= 9999;

  const employeeNumError = (): string | null => {
    if (form.employeeNum == null) return null;
    if (!Number.isInteger(form.employeeNum)) return 'Must be an integer';
    if (!isEmployeeNumValid(form.employeeNum)) return 'Must be exactly 4 digits';
    return null;
  };

  const formHasErrors = (): boolean => employeeNumError() !== null;

  const allRequiredFilled = (): boolean =>
    !!form.ghEmployee.trim() && form.employeeNum != null && form.teamId != null;

  const handleFormSave = async () => {
    if (!form.ghEmployee.trim()) {
      toast({ title: 'Validation Error', description: 'Employee Name is required.', variant: 'destructive' });
      return;
    }
    if (!form.employeeNum) {
      toast({ title: 'Validation Error', description: 'Employee Number is required.', variant: 'destructive' });
      return;
    }
    if (!isEmployeeNumValid(form.employeeNum)) {
      toast({ title: 'Validation Error', description: 'Employee Number must be exactly 4 digits.', variant: 'destructive' });
      return;
    }
    if (!form.teamId) {
      toast({ title: 'Validation Error', description: 'Team is required.', variant: 'destructive' });
      return;
    }

    const payload = {
      ghEmployee: form.ghEmployee.trim(),
      employeeNum: form.employeeNum,
      teamId: form.teamId,
      userLevelFk: form.userLevelFk ?? 1,
      email: form.email.trim() || undefined,
      active: form.active,
    };

    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: payload });
        toast({ title: 'Updated', description: 'Employee updated successfully.' });
      } else {
        await createMutation.mutateAsync({ data: payload });
        toast({ title: 'Created', description: 'New employee created successfully.' });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/employees'] });
      setFormOpen(false);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string }; response?: { data?: { message?: string } }; message?: string };
      const msg =
        err?.data?.message ||
        err?.response?.data?.message ||
        err?.message?.match(/:\s*(.+)$/)?.[1] ||
        err?.message ||
        'Failed to save employee.';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    }
  };

  const handleInactivate = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteConfirm.id });
      toast({ title: 'Inactivated', description: 'Employee inactivated successfully.' });
      queryClient.invalidateQueries({ queryKey: ['/api/employees'] });
      setDeleteConfirm(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to inactivate employee.', variant: 'destructive' });
    }
  };

  const setField = <K extends keyof EmployeeFormData>(key: K, val: EmployeeFormData[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setNameSearch('');
    setUserLevelFilter('');
    setActiveFilter('true');
      setResetPageSignal(s => s + 1);
  };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('reference.employees.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('reference.employees.description')}</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={handleNew} className="gap-1.5 rounded-lg">
              <Plus className="w-3.5 h-3.5" /> New Employee
            </Button>
          )}
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <Input
            placeholder={t('common.typeToSearch')}
            value={nameSearch}
            onChange={e => setNameSearch(e.target.value)}
            className="w-52"
          />
          <select
            value={userLevelFilter}
            onChange={e => setUserLevelFilter(e.target.value)}
            className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
          >
            <option value="">All Levels</option>
            {USER_LEVELS.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
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
          resetPageSignal={resetPageSignal}
          data={employees}
          columns={columns}
          title="Employees"
        />

        {formOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{editingId ? 'Edit Employee' : 'New Employee'}</h2>
                <button onClick={() => setFormOpen(false)} className="p-1 rounded hover:bg-muted"><X size={18} /></button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Employee Name *</label>
                  <input
                    type="text"
                    value={form.ghEmployee}
                    onChange={e => setField('ghEmployee', e.target.value)}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                    placeholder="Full Name"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Employee # *</label>
                  <input
                    type="number"
                    min={1000}
                    max={9999}
                    step={1}
                    value={form.employeeNum ?? ''}
                    onChange={e => setField('employeeNum', e.target.value === '' ? null : parseInt(e.target.value))}
                    className={`w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 outline-none ${
                      employeeNumError() ? 'border-destructive focus:ring-destructive' : 'focus:ring-primary'
                    }`}
                    aria-invalid={!!employeeNumError()}
                    placeholder="4-digit code"
                  />
                  {employeeNumError() && <p className="text-xs text-destructive">{employeeNumError()}</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Team *</label>
                  <select
                    value={form.teamId ?? ''}
                    onChange={e => setField('teamId', e.target.value === '' ? null : parseInt(e.target.value))}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                  >
                    <option value="">-- Select Team --</option>
                    {allTeams.map(t => (
                      <option key={t.id} value={t.id}>{t.teamName}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setField('email', e.target.value)}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                    placeholder="email@example.com"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">User Level</label>
                  <select
                    value={form.userLevelFk ?? 1}
                    onChange={e => setField('userLevelFk', parseInt(e.target.value))}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                  >
                    {USER_LEVELS.map(l => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Active</label>
                  <select
                    value={form.active ? 'true' : 'false'}
                    onChange={e => setField('active', e.target.value === 'true')}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleFormSave}
                  disabled={
                    createMutation.isPending ||
                    updateMutation.isPending ||
                    !allRequiredFilled() ||
                    formHasErrors()
                  }
                >
                  {createMutation.isPending || updateMutation.isPending ? 'Saving...' : editingId ? 'Update' : 'Create'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <h2 className="text-lg font-semibold">Inactivate Employee</h2>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to inactivate <strong>{deleteConfirm.ghEmployee}</strong>? They will no longer appear in the active employees list.
              </p>
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
