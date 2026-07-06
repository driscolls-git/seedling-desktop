import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  useListDeadlines,
  useCreateDeadline,
  useUpdateDeadline,
  useDeleteDeadline,
  useListTeams,
  useListBerries,
  useListPrograms,
  useListLocations,
  Deadline,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, X, RotateCcw, Info, Copy, Calendar } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

type DeadlineFormData = {
  berryId: number | null;
  teamId: number | null;
  destinationId: number | null;
  programId: number | null;
  crossingFileDeadline: number | null;
  pollinationStart: number | null;
  pollinationDeadline: number | null;
  fruitCollectStart: number | null;
  fruitCollectDeadline: number | null;
  seedAcidStart: number | null;
  seedAcidDeadline: number | null;
  seedSowStart: number | null;
  seedSowDeadline: number | null;
  transplantStart: number | null;
  transplantDeadline: number | null;
  markerScreenStart: number | null;
  markerScreenDeadline: number | null;
  markerResultsDeadline: number | null;
  comments: string;
};

const emptyForm: DeadlineFormData = {
  berryId: null,
  teamId: null,
  destinationId: null,
  programId: null,
  crossingFileDeadline: null,
  pollinationStart: null,
  pollinationDeadline: null,
  fruitCollectStart: null,
  fruitCollectDeadline: null,
  seedAcidStart: null,
  seedAcidDeadline: null,
  seedSowStart: null,
  seedSowDeadline: null,
  transplantStart: null,
  transplantDeadline: null,
  markerScreenStart: null,
  markerScreenDeadline: null,
  markerResultsDeadline: null,
  comments: '',
};

function deadlineToForm(r: Deadline): DeadlineFormData {
  return {
    berryId: r.berryId ?? null,
    teamId: r.teamId ?? null,
    destinationId: r.destinationId ?? null,
    programId: r.programId ?? null,
    crossingFileDeadline: r.crossingFileDeadline ?? null,
    pollinationStart: r.pollinationStart ?? null,
    pollinationDeadline: r.pollinationDeadline ?? null,
    fruitCollectStart: r.fruitCollectStart ?? null,
    fruitCollectDeadline: r.fruitCollectDeadline ?? null,
    seedAcidStart: r.seedAcidStart ?? null,
    seedAcidDeadline: r.seedAcidDeadline ?? null,
    seedSowStart: r.seedSowStart ?? null,
    seedSowDeadline: r.seedSowDeadline ?? null,
    transplantStart: r.transplantStart ?? null,
    transplantDeadline: r.transplantDeadline ?? null,
    markerScreenStart: r.markerScreenStart ?? null,
    markerScreenDeadline: r.markerScreenDeadline ?? null,
    markerResultsDeadline: r.markerResultsDeadline ?? null,
    comments: r.comments ?? '',
  };
}

export default function DeadlinesList() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [destinationIds, setDestinationIds] = useState<number[]>([]);
  const [programIds, setProgramIds] = useState<number[]>([]);
  const [fieldPlantDate, setFieldPlantDate] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<DeadlineFormData>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; label: string } | null>(null);

  const queryParams = {
    berryId: filters.berryId,
    ...(filters.teamId ? { teamId: filters.teamId } : {}),
    ...(destinationIds.length > 0 ? { destinationId: destinationIds.join(',') } : {}),
    ...(programIds.length > 0 ? { programId: programIds.join(',') } : {}),
    active: true,
  } as any;

  const { data: deadlinesData } = useListDeadlines(queryParams);
  const { data: allActiveDeadlines } = useListDeadlines({ active: true });
  const { data: teamsData } = useListTeams();
  const { data: berriesData } = useListBerries();
  const { data: locationsData } = useListLocations({ active: true });
  const { data: programsData } = useListPrograms({ berryId: form.berryId ?? undefined });
  const { data: filterPrograms } = useListPrograms({ berryId: filters.berryId, active: true });

  const allTeams = useMemo(() => teamsData || [], [teamsData]);
  const allBerries = useMemo(() => berriesData || [], [berriesData]);
  const allLocations = useMemo(() => locationsData || [], [locationsData]);
  const allPrograms = useMemo(() => programsData || [], [programsData]);

  const createMutation = useCreateDeadline();
  const updateMutation = useUpdateDeadline();
  const deleteMutation = useDeleteDeadline();

  const rows = useMemo(() => (deadlinesData || []) as Deadline[], [deadlinesData]);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  };

  const showDates = !!fieldPlantDate;
  const baseDate = useMemo(() => {
    if (!fieldPlantDate) return null;
    return new Date(fieldPlantDate + 'T00:00:00');
  }, [fieldPlantDate]);

  const addWeeks = (base: Date, weeks: number): Date => {
    const result = new Date(base);
    result.setDate(result.getDate() + weeks * 7);
    return result;
  };

  const fmtCalcDate = (d: Date): string =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const dateOrWeek = (v: number | null | undefined) => {
    if (v == null) return '';
    if (showDates && baseDate) return fmtCalcDate(addWeeks(baseDate, v));
    return String(v);
  };

  type WkKey = 'crossingFileDeadline' | 'pollinationStart' | 'pollinationDeadline'
    | 'fruitCollectStart' | 'fruitCollectDeadline' | 'seedAcidStart' | 'seedAcidDeadline'
    | 'seedSowStart' | 'seedSowDeadline' | 'transplantStart' | 'transplantDeadline'
    | 'markerScreenStart' | 'markerScreenDeadline' | 'markerResultsDeadline';

  const wkColDef = (key: WkKey, header: string): ColumnDef<Deadline> => ({
    key,
    header,
    isNumeric: !showDates,
    width: showDates ? 'w-32' : 'w-24',
    render: (r: Deadline) => dateOrWeek(r[key] as number | null),
  });

  const columns: ColumnDef<Deadline>[] = [
    ...(isAdmin ? [{
      key: '_actions' as keyof Deadline,
      header: 'Actions',
      width: 'w-24',
      render: (row: Deadline) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); handleEdit(row); }}
            className="p-1 rounded hover:bg-primary/10 text-primary"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleCopyAsNew(row); }}
            className="p-1 rounded hover:bg-primary/10 text-primary"
            title="Copy as New"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteConfirm({
                id: row.id,
                label: `${row.berryType} / ${row.teamName} / ${row.destination} / ${row.srcBreedingProgram}`,
              });
            }}
            className="p-1 rounded hover:bg-destructive/10 text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    }] : []),
    { key: 'berryType', header: 'Berry', width: 'w-20', sticky: true },
    { key: 'teamName', header: 'Team', width: 'w-24' },
    { key: 'destination', header: 'Destination', width: 'w-28' },
    { key: 'srcBreedingProgram', header: 'Program', width: 'w-32' },
    wkColDef('crossingFileDeadline', 'Crossing File Deadline'),
    wkColDef('pollinationStart', 'Pollination Start'),
    wkColDef('pollinationDeadline', 'Pollination Deadline'),
    wkColDef('fruitCollectStart', 'Fruit Collect Start'),
    wkColDef('fruitCollectDeadline', 'Fruit Collect Deadline'),
    wkColDef('seedAcidStart', 'Seed Acid Start'),
    wkColDef('seedAcidDeadline', 'Seed Acid Deadline'),
    wkColDef('seedSowStart', 'Seed Sow Start'),
    wkColDef('seedSowDeadline', 'Seed Sow Deadline'),
    wkColDef('transplantStart', 'Transplant Start'),
    wkColDef('transplantDeadline', 'Transplant Deadline'),
    wkColDef('markerScreenStart', 'Marker Screen Start'),
    wkColDef('markerScreenDeadline', 'Marker Screen Deadline'),
    wkColDef('markerResultsDeadline', 'Marker Results Deadline'),
    { key: 'comments', header: 'Comments', width: 'w-48' },
    { key: 'modifiedDate', header: 'Modified Date', width: 'w-28', render: (r) => formatDate(r.modifiedDate) },
    { key: 'modifiedBy', header: 'Modified By', width: 'w-28' },
    { key: 'id', header: 'ID', isNumeric: true, width: 'w-16' },
  ];

  const handleEdit = (row: Deadline) => {
    setEditingId(row.id);
    setForm(deadlineToForm(row));
    setFormOpen(true);
  };

  const handleCopyAsNew = (row: Deadline) => {
    setEditingId(null);
    setForm(deadlineToForm(row));
    setFormOpen(true);
  };

  const handleNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const FIELD_LABELS: Record<string, string> = {
    berryId: 'Berry',
    teamId: 'Team',
    destinationId: 'Destination',
    programId: 'Program',
    crossingFileDeadline: 'Crossing File Deadline',
    pollinationStart: 'Pollination Start',
    pollinationDeadline: 'Pollination Deadline',
    fruitCollectStart: 'Fruit Collect Start',
    fruitCollectDeadline: 'Fruit Collect Deadline',
    seedAcidStart: 'Seed Acid Start',
    seedAcidDeadline: 'Seed Acid Deadline',
    seedSowStart: 'Seed Sow Start',
    seedSowDeadline: 'Seed Sow Deadline',
    transplantStart: 'Transplant Start',
    transplantDeadline: 'Transplant Deadline',
    markerScreenStart: 'Marker Screen Start',
    markerScreenDeadline: 'Marker Screen Deadline',
    markerResultsDeadline: 'Marker Results Deadline',
  };

  const REQUIRED_FIELDS: (keyof DeadlineFormData)[] = [
    'berryId', 'teamId', 'destinationId', 'programId',
    'crossingFileDeadline', 'pollinationStart', 'pollinationDeadline',
    'fruitCollectStart', 'fruitCollectDeadline', 'seedAcidStart',
    'seedAcidDeadline', 'seedSowStart', 'seedSowDeadline',
    'transplantStart', 'transplantDeadline', 'markerScreenStart',
    'markerScreenDeadline', 'markerResultsDeadline',
  ];

  const DEADLINE_ORDER: (keyof DeadlineFormData)[] = [
    'crossingFileDeadline', 'pollinationDeadline',
    'fruitCollectDeadline', 'seedAcidDeadline',
    'seedSowDeadline', 'transplantDeadline',
    'markerScreenDeadline', 'markerResultsDeadline',
  ];

  // Index of each Deadline in DEADLINE_ORDER for quick prev-step lookup
  // when rendering inline sequence errors on the corresponding inputs.
  const DEADLINE_INDEX: Record<string, number> = Object.fromEntries(
    DEADLINE_ORDER.map((k, i) => [k as string, i]),
  );

  // Every numeric "week offset" field on the form. Each must be a 0-or-negative
  // integer (planting is week 0; all activities happen before).
  const WEEK_FIELDS: (keyof DeadlineFormData)[] = [
    'crossingFileDeadline', 'pollinationStart', 'pollinationDeadline',
    'fruitCollectStart', 'fruitCollectDeadline', 'seedAcidStart',
    'seedAcidDeadline', 'seedSowStart', 'seedSowDeadline',
    'transplantStart', 'transplantDeadline', 'markerScreenStart',
    'markerScreenDeadline', 'markerResultsDeadline',
  ];

  const handleFormSave = async () => {
    for (const key of REQUIRED_FIELDS) {
      const v = form[key];
      if (v === null || v === undefined || v === '') {
        toast({ title: 'Validation Error', description: `${FIELD_LABELS[key]} is required.`, variant: 'destructive' });
        return;
      }
    }

    for (const key of WEEK_FIELDS) {
      const v = form[key] as number | null;
      if (v == null) continue;
      if (!Number.isInteger(v) || v > 0) {
        toast({
          title: 'Validation Error',
          description: `${FIELD_LABELS[key]} must be 0 or a negative integer.`,
          variant: 'destructive',
        });
        return;
      }
    }

    // Each Deadline must be MORE NEGATIVE THAN OR EQUAL TO the next deadline
    // going left-to-right / top-to-bottom (prev <= curr numerically).
    // Equal is OK; strict-greater-than is the failure.  Start fields are
    // intentionally NOT in this restriction.
    for (let i = 1; i < DEADLINE_ORDER.length; i++) {
      const prevKey = DEADLINE_ORDER[i - 1];
      const currKey = DEADLINE_ORDER[i];
      const prevVal = form[prevKey] as number | null;
      const currVal = form[currKey] as number | null;
      if (prevVal != null && currVal != null && prevVal > currVal) {
        toast({
          title: 'Validation Error',
          description: `${FIELD_LABELS[currKey]} (${currVal}) must be on or after ${FIELD_LABELS[prevKey]} (${prevVal}).`,
          variant: 'destructive',
        });
        return;
      }
    }

    if (!editingId) {
      const duplicate = (allActiveDeadlines || []).find((d: Deadline) =>
        d.berryId === form.berryId && d.teamId === form.teamId && d.destinationId === form.destinationId && d.programId === form.programId
      );
      if (duplicate) {
        toast({ title: 'Duplicate Entry', description: 'An active deadline with this Berry, Team, Destination, and Program combination already exists.', variant: 'destructive' });
        return;
      }
    }

    // Required fields guaranteed non-null by the validation loop above.
    const payload = {
      berryId: form.berryId!,
      teamId: form.teamId!,
      destinationId: form.destinationId!,
      programId: form.programId ?? undefined,
      crossingFileDeadline: form.crossingFileDeadline ?? undefined,
      pollinationStart: form.pollinationStart ?? undefined,
      pollinationDeadline: form.pollinationDeadline ?? undefined,
      fruitCollectStart: form.fruitCollectStart ?? undefined,
      fruitCollectDeadline: form.fruitCollectDeadline ?? undefined,
      seedAcidStart: form.seedAcidStart ?? undefined,
      seedAcidDeadline: form.seedAcidDeadline ?? undefined,
      seedSowStart: form.seedSowStart ?? undefined,
      seedSowDeadline: form.seedSowDeadline ?? undefined,
      transplantStart: form.transplantStart ?? undefined,
      transplantDeadline: form.transplantDeadline ?? undefined,
      markerScreenStart: form.markerScreenStart ?? undefined,
      markerScreenDeadline: form.markerScreenDeadline ?? undefined,
      markerResultsDeadline: form.markerResultsDeadline ?? undefined,
      comments: form.comments || undefined,
      active: true,
    };

    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: payload });
        toast({ title: 'Updated', description: 'Deadline updated successfully.' });
      } else {
        await createMutation.mutateAsync({ data: payload });
        toast({ title: 'Created', description: 'New deadline created successfully.' });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/deadlines'] });
      setFormOpen(false);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string }; response?: { data?: { message?: string } }; message?: string };
      const msg =
        err?.data?.message ||
        err?.response?.data?.message ||
        err?.message?.match(/:\s*(.+)$/)?.[1] ||
        err?.message ||
        'Failed to save deadline.';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    }
  };

  const handleInactivate = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteConfirm.id });
      toast({ title: 'Inactivated', description: 'Deadline inactivated successfully.' });
      queryClient.invalidateQueries({ queryKey: ['/api/deadlines'] });
      setDeleteConfirm(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to inactivate deadline.', variant: 'destructive' });
    }
  };

  const setField = <K extends keyof DeadlineFormData>(key: K, val: DeadlineFormData[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const isRequired = (key: keyof DeadlineFormData) => REQUIRED_FIELDS.includes(key);
  const isWeekField = (key: keyof DeadlineFormData) => WEEK_FIELDS.includes(key);

  // Per-field validation for inline visual feedback.  For Deadline fields
  // (positions in DEADLINE_ORDER) we ALSO surface the cross-step sequence
  // error here, so the offending input shows a red border and a message
  // explaining why the Save button is disabled — otherwise the gate looks
  // silent and the user can't tell what's wrong.  Start fields are not
  // included in the sequence restriction.
  const fieldError = (key: keyof DeadlineFormData): string | null => {
    if (!isWeekField(key)) return null;
    const v = form[key] as number | null;
    if (v == null) return null;
    if (!Number.isInteger(v)) return 'Must be an integer';
    if (v > 0) return 'Must be 0 or negative';
    const idx = DEADLINE_INDEX[key as string];
    if (typeof idx === "number" && idx > 0) {
      const prevKey = DEADLINE_ORDER[idx - 1];
      const prevVal = form[prevKey] as number | null;
      if (prevVal != null && prevVal > v) {
        return `Must be on or after ${FIELD_LABELS[prevKey]} (${prevVal})`;
      }
    }
    return null;
  };

  // Used to gate the Save button so it only enables once the form is valid.
  // fieldError now covers both per-field rules and the cross-step sequence
  // for Deadline fields, so this is a single sweep.
  const formHasErrors = (): boolean =>
    WEEK_FIELDS.some(k => fieldError(k) !== null);

  const allRequiredFilled = (): boolean =>
    REQUIRED_FIELDS.every(k => {
      const v = form[k];
      return v !== null && v !== undefined && v !== '';
    });

  const numInput = (label: string, key: keyof DeadlineFormData) => {
    const err = fieldError(key);
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">{label}{isRequired(key) ? ' *' : ''}</label>
        <input
          type="number"
          step="1"
          max={0}
          value={form[key] ?? ''}
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') { setField(key, null as any); return; }
            const n = parseInt(raw);
            if (!Number.isFinite(n)) { setField(key, null as any); return; }
            setField(key, n as any);
          }}
          className={`w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 outline-none ${
            err ? 'border-destructive focus:ring-destructive' : 'focus:ring-primary'
          }`}
          aria-invalid={!!err}
          placeholder="Week #"
        />
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    );
  };

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setDestinationIds([]);
    setProgramIds([]);
    setFieldPlantDate('');
    setResetPageSignal(s => s + 1);
  };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('reference.deadlines.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('reference.deadlines.description')}</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={handleNew} className="gap-1.5 rounded-lg">
              <Plus className="w-3.5 h-3.5" /> New Deadline
            </Button>
          )}
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <MultiSelect
            value={destinationIds}
            onChange={setDestinationIds}
            options={allLocations.map((l: any) => ({ value: l.id, label: l.locationName }))}
            placeholder="All Destinations"
            className="w-52"
          />
          <MultiSelect
            value={programIds}
            onChange={setProgramIds}
            options={(filterPrograms || []).map((p: any) => ({ value: p.id, label: p.srcBreedingProgram }))}
            placeholder="All Programs"
            className="w-52"
          />

          <div className="h-6 w-px bg-border mx-1" />

          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Field Plant Date</label>
            <input
              type="date"
              value={fieldPlantDate}
              onChange={e => setFieldPlantDate(e.target.value)}
              className="border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          {showDates && (
            <span className="text-xs text-primary font-medium bg-primary/10 px-2 py-1 rounded-full">
              Showing calculated dates
            </span>
          )}

          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal}
          data={rows}
          columns={columns}
          title="Deadlines"
          rowKey="id"
        />
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setFormOpen(false)}>
          <div className="bg-card rounded-2xl border shadow-xl w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-card z-10">
              <h3 className="font-semibold text-lg text-foreground">
                {editingId ? 'Edit Deadlines' : 'New Deadline Entry'}
              </h3>
              <button onClick={() => setFormOpen(false)} className="p-1 rounded-lg hover:bg-secondary/20">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Berry *</label>
                  <select
                    value={form.berryId ?? ''}
                    onChange={e => {
                      const val = e.target.value ? parseInt(e.target.value) : null;
                      setForm(prev => ({ ...prev, berryId: val, programId: null }));
                    }}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                  >
                    <option value="">Select Berry</option>
                    {allBerries.map((b: any) => (
                      <option key={b.id} value={b.id}>{b.berryType}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Team *</label>
                  <select
                    value={form.teamId ?? ''}
                    onChange={e => setField('teamId', e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                  >
                    <option value="">Select Team</option>
                    {allTeams.map(t => (
                      <option key={t.id} value={t.id}>{t.teamName}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Destination *</label>
                  <select
                    value={form.destinationId ?? ''}
                    onChange={e => setField('destinationId', e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                  >
                    <option value="">Select Destination</option>
                    {allLocations.map((l: any) => (
                      <option key={l.id} value={l.id}>{l.locationName}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Program *</label>
                  <select
                    value={form.programId ?? ''}
                    onChange={e => setField('programId', e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
                  >
                    <option value="">Select Program</option>
                    {allPrograms.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.srcBreedingProgram}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-6 gap-3">
                {numInput('Crossing File Deadline', 'crossingFileDeadline')}
                {numInput('Pollination Start', 'pollinationStart')}
                {numInput('Pollination Deadline', 'pollinationDeadline')}
                {numInput('Fruit Collect Start', 'fruitCollectStart')}
                {numInput('Fruit Collect Deadline', 'fruitCollectDeadline')}
                {numInput('Seed Acid Start', 'seedAcidStart')}
              </div>

              <div className="grid grid-cols-6 gap-3">
                {numInput('Seed Acid Deadline', 'seedAcidDeadline')}
                {numInput('Seed Sow Start', 'seedSowStart')}
                {numInput('Seed Sow Deadline', 'seedSowDeadline')}
                {numInput('Transplant Start', 'transplantStart')}
                {numInput('Transplant Deadline', 'transplantDeadline')}
                {numInput('Marker Screen Start', 'markerScreenStart')}
              </div>

              <div className="grid grid-cols-6 gap-3">
                {numInput('Marker Screen Deadline', 'markerScreenDeadline')}
                {numInput('Marker Results Deadline', 'markerResultsDeadline')}
                <div className="col-span-4 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Comments</label>
                  <textarea
                    value={form.comments}
                    onChange={e => setField('comments', e.target.value)}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none resize-none"
                    rows={2}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-card rounded-2xl border shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-foreground">Inactivate Deadline</h3>
              <button onClick={() => setDeleteConfirm(null)} className="p-1 rounded-lg hover:bg-secondary/20">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to inactivate this Deadline? <strong>{deleteConfirm.label}</strong>
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>No</Button>
              <Button variant="destructive" onClick={handleInactivate} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Inactivating...' : 'Yes, Inactivate'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 border rounded-xl p-5 bg-muted/20 space-y-3">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-sm font-semibold text-foreground">Purpose of Deadlines</p>
        </div>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground ml-6">
          <li>Provide automated email reminders for certain deadlines.</li>
          <li>Prevent changing calculated required amounts for each step in the propagation process that are already past the deadline dates.</li>
          <li>Used as a checkbox filter in KPI graphs for required amounts meeting deadline dates or not.</li>
        </ol>
      </div>
    </Layout>
  );
}
