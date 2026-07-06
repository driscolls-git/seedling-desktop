import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { Layout } from '@/components/layout/Layout';
import { DataTable, ColumnDef } from '@/components/ui/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { PropCalcsPanel } from '@/components/ui/PropCalcsPanel';
import { PropCalcsCalculator } from '@/components/ui/PropCalcsCalculator';
import {
  useListRatios,
  useCreateRatio,
  useUpdateRatio,
  useDeleteRatio,
  useListTeams,
  useListBerries,
  useListPrograms,
  Ratio,
} from '@workspace/api-client-react';
import { formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, X, RotateCcw, Copy } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

type RatioFormData = {
  teamId: number | null;
  berryId: number | null;
  programId: number | null;
  seedlingTransplantSuccessPercentage: number | null;
  avgSeedGerminationPercentage: number | null;
  seedGerminationStdDev: number | null;
  seedSowBufferGrams: number | null;
  seedsPerGramOfSeed: number | null;
  seedNumPerGramStdDev: number | null;
  gramsSeedPerFruit: number | null;
  gramsSeedPerFruitStdDev: number | null;
  pollinationSuccessPercentage: number | null;
  pollinationStdDev: number | null;
  femaleFlowersPerMaleFlower: number | null;
  avgFlowersPerParent: number | null;
  flowersPerParentStdDev: number | null;
  bufferPercentOfStdDev: number | null;
  comments: string;
};

const emptyForm: RatioFormData = {
  teamId: null,
  berryId: null,
  programId: null,
  seedlingTransplantSuccessPercentage: null,
  avgSeedGerminationPercentage: null,
  seedGerminationStdDev: null,
  seedSowBufferGrams: null,
  seedsPerGramOfSeed: null,
  seedNumPerGramStdDev: null,
  gramsSeedPerFruit: null,
  gramsSeedPerFruitStdDev: null,
  pollinationSuccessPercentage: null,
  pollinationStdDev: null,
  femaleFlowersPerMaleFlower: null,
  avgFlowersPerParent: null,
  flowersPerParentStdDev: null,
  bufferPercentOfStdDev: null,
  comments: '',
};

// Fields that must be in the (0, 100] percent range.
const PCT_FIELDS: (keyof RatioFormData)[] = [
  'seedlingTransplantSuccessPercentage',
  'avgSeedGerminationPercentage',
  'pollinationSuccessPercentage',
  'bufferPercentOfStdDev',
];

// Std deviation fields paired with their corresponding mean.  Per spec:
//   std dev >= 0 (no negatives) AND std dev <= mean.
//   Std devs that share a percent-scale (e.g. germination % std dev) are
//   ALSO bounded above by 100, since the mean itself can't exceed 100.
const STD_DEV_PAIRS: { key: keyof RatioFormData; meanKey: keyof RatioFormData }[] = [
  { key: 'pollinationStdDev', meanKey: 'pollinationSuccessPercentage' },
  { key: 'seedGerminationStdDev', meanKey: 'avgSeedGerminationPercentage' },
  { key: 'gramsSeedPerFruitStdDev', meanKey: 'gramsSeedPerFruit' },
  { key: 'seedNumPerGramStdDev', meanKey: 'seedsPerGramOfSeed' },
  { key: 'flowersPerParentStdDev', meanKey: 'avgFlowersPerParent' },
];

function decToDisplay(v: number | null | undefined): number | null {
  return v != null ? Math.round(v * 100 * 1e6) / 1e6 : null;
}

function displayToDec(v: number | null): number | null {
  return v != null ? v / 100 : null;
}

function ratioToForm(r: Ratio): RatioFormData {
  return {
    teamId: r.teamId ?? null,
    berryId: r.berryId ?? null,
    programId: r.programId ?? null,
    seedlingTransplantSuccessPercentage: decToDisplay(r.seedlingTransplantSuccessPercentage),
    avgSeedGerminationPercentage: decToDisplay(r.avgSeedGerminationPercentage),
    seedGerminationStdDev: decToDisplay(r.seedGerminationStdDev),
    seedSowBufferGrams: r.seedSowBufferGrams ?? null,
    seedsPerGramOfSeed: r.seedsPerGramOfSeed ?? null,
    seedNumPerGramStdDev: r.seedNumPerGramStdDev ?? null,
    gramsSeedPerFruit: r.gramsSeedPerFruit ?? null,
    gramsSeedPerFruitStdDev: r.gramsSeedPerFruitStdDev ?? null,
    pollinationSuccessPercentage: decToDisplay(r.pollinationSuccessPercentage),
    pollinationStdDev: decToDisplay(r.pollinationStdDev),
    femaleFlowersPerMaleFlower: r.femaleFlowersPerMaleFlower ?? null,
    avgFlowersPerParent: r.avgFlowersPerParent ?? null,
    flowersPerParentStdDev: r.flowersPerParentStdDev ?? null,
    bufferPercentOfStdDev: decToDisplay(r.bufferPercentOfStdDev),
    comments: r.comments ?? '',
  };
}

export default function RatiosList() {
  const { t } = useTranslation();
  const { filters } = useFilters();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [programIds, setProgramIds] = useState<number[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RatioFormData>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);

  // Backdrop close handler that only fires when the click *started* on the
  // backdrop itself.  Without this, dragging to select text inside an input
  // and releasing past the modal's edge would fire `click` on the backdrop
  // (mousedown + mouseup were on different elements, so React dispatches the
  // click to their common ancestor), unexpectedly closing the form mid-edit.
  const backdropMouseDownTarget = React.useRef<EventTarget | null>(null);
  const onBackdropMouseDown = (e: React.MouseEvent) => {
    backdropMouseDownTarget.current = e.target;
  };
  const onBackdropClick = (close: () => void) => (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && backdropMouseDownTarget.current === e.currentTarget) {
      close();
    }
    backdropMouseDownTarget.current = null;
  };

  const queryParams = {
    berryId: filters.berryId,
    ...(filters.teamId ? { teamId: filters.teamId } : {}),
    ...(programIds.length > 0 ? { programId: programIds.join(',') } : {}),
    active: true,
  } as any;

  const { data: ratiosData } = useListRatios(queryParams);
  const { data: allActiveRatios } = useListRatios({ active: true });
  const { data: teamsData } = useListTeams();
  const { data: berriesData } = useListBerries();
  const { data: programsData } = useListPrograms({ berryId: form.berryId ?? undefined });

  const allTeams = useMemo(() => teamsData || [], [teamsData]);
  const allBerries = useMemo(() => berriesData || [], [berriesData]);
  const allPrograms = useMemo(() => programsData || [], [programsData]);

  const createMutation = useCreateRatio();
  const updateMutation = useUpdateRatio();
  const deleteMutation = useDeleteRatio();

  const rows = useMemo(() => (ratiosData || []) as Ratio[], [ratiosData]);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  };

  const numCol = (v: number | null | undefined) => v != null ? formatNumber(v) : '';
  const pctCol = (v: number | null | undefined) => v != null ? `${formatNumber(Math.round(v * 100 * 1e6) / 1e6)}%` : '';
  const dec2Col = (v: number | null | undefined) => v != null ? v.toFixed(2) : '';

  const columns: ColumnDef<Ratio>[] = [
    ...(isAdmin ? [{
      key: '_actions' as keyof Ratio,
      header: 'Actions',
      width: 'w-24',
      render: (row: Ratio) => (
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
            onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: row.id, name: `${row.teamName} / ${row.berryType}` }); }}
            className="p-1 rounded hover:bg-destructive/10 text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    }] : []),
    { key: 'teamName', header: 'Team', width: 'w-28', sticky: true },
    { key: 'berryType', header: 'Berry', width: 'w-20' },
    { key: 'srcBreedingProgram', header: 'Program', width: 'w-32' },
    { key: 'seedlingTransplantSuccessPercentage', header: 'Seedling Transplant %', isNumeric: true, width: 'w-24', render: (r) => pctCol(r.seedlingTransplantSuccessPercentage) },
    { key: 'avgSeedGerminationPercentage', header: 'Avg Seed Germ %', isNumeric: true, width: 'w-24', render: (r) => pctCol(r.avgSeedGerminationPercentage) },
    { key: 'seedGerminationStdDev', header: 'Seed Germ Std Dev', isNumeric: true, width: 'w-24', render: (r) => pctCol(r.seedGerminationStdDev) },
    { key: 'seedSowBufferGrams', header: 'Seed Sow Buffer g', isNumeric: true, width: 'w-24', render: (r) => dec2Col(r.seedSowBufferGrams) },
    { key: 'seedsPerGramOfSeed', header: 'Seeds Per Gram', isNumeric: true, width: 'w-24', render: (r) => numCol(r.seedsPerGramOfSeed) },
    { key: 'seedNumPerGramStdDev', header: 'Seeds/Gram Std Dev', isNumeric: true, width: 'w-24', render: (r) => numCol(r.seedNumPerGramStdDev) },
    { key: 'gramsSeedPerFruit', header: 'Grams Seed/Fruit', isNumeric: true, width: 'w-24', render: (r) => dec2Col(r.gramsSeedPerFruit) },
    { key: 'gramsSeedPerFruitStdDev', header: 'Seed g/Fruit Std Dev', isNumeric: true, width: 'w-24', render: (r) => dec2Col(r.gramsSeedPerFruitStdDev) },
    { key: 'pollinationSuccessPercentage', header: 'Pollination Success %', isNumeric: true, width: 'w-24', render: (r) => pctCol(r.pollinationSuccessPercentage) },
    { key: 'pollinationStdDev', header: 'Pollination Std Dev', isNumeric: true, width: 'w-24', render: (r) => pctCol(r.pollinationStdDev) },
    { key: 'femaleFlowersPerMaleFlower', header: 'Female Flowers/Male', isNumeric: true, width: 'w-24', render: (r) => numCol(r.femaleFlowersPerMaleFlower) },
    { key: 'avgFlowersPerParent', header: 'Avg Flowers/Parent', isNumeric: true, width: 'w-24', render: (r) => numCol(r.avgFlowersPerParent) },
    { key: 'flowersPerParentStdDev', header: 'Flowers/Parent Std Dev', isNumeric: true, width: 'w-24', render: (r) => numCol(r.flowersPerParentStdDev) },
    { key: 'bufferPercentOfStdDev', header: 'Buffer % of Std Dev', isNumeric: true, width: 'w-24', render: (r) => pctCol(r.bufferPercentOfStdDev) },
    { key: 'comments', header: 'Comments', width: 'w-64' },
    { key: 'modifiedDate', header: 'Modified Date', width: 'w-28', render: (r) => formatDate(r.modifiedDate) },
    { key: 'modifiedBy', header: 'Modified By', width: 'w-28' },
    { key: 'id', header: 'ID', isNumeric: true, width: 'w-16' },
  ];

  const handleEdit = (row: Ratio) => {
    setEditingId(row.id);
    setForm(ratioToForm(row));
    setFormOpen(true);
  };

  const handleCopyAsNew = (row: Ratio) => {
    setEditingId(null);
    setForm(ratioToForm(row));
    setFormOpen(true);
  };

  const handleNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const FIELD_LABELS: Record<string, string> = {
    teamId: 'Team',
    berryId: 'Berry',
    programId: 'Program',
    seedlingTransplantSuccessPercentage: 'Seedling Transplant Success %',
    avgSeedGerminationPercentage: 'Avg Seed Germination %',
    seedGerminationStdDev: 'Seed Germ Std Dev',
    seedSowBufferGrams: 'Seed Sow Buffer (g)',
    seedsPerGramOfSeed: 'Seeds Per Gram',
    seedNumPerGramStdDev: 'Seeds/Gram Std Dev',
    gramsSeedPerFruit: 'Grams Seed Per Fruit',
    gramsSeedPerFruitStdDev: 'Seed g/Fruit Std Dev',
    pollinationSuccessPercentage: 'Pollination Success %',
    pollinationStdDev: 'Pollination Std Dev',
    femaleFlowersPerMaleFlower: 'Female Flowers/Male',
    avgFlowersPerParent: 'Avg Flowers Per Parent',
    flowersPerParentStdDev: 'Flowers/Parent Std Dev',
    bufferPercentOfStdDev: 'Buffer % of Std Dev',
  };

  const REQUIRED_FIELDS: (keyof RatioFormData)[] = [
    'teamId', 'berryId', 'programId',
    'seedlingTransplantSuccessPercentage', 'avgSeedGerminationPercentage',
    'seedGerminationStdDev', 'seedSowBufferGrams', 'seedsPerGramOfSeed',
    'seedNumPerGramStdDev', 'gramsSeedPerFruit', 'gramsSeedPerFruitStdDev',
    'pollinationSuccessPercentage', 'pollinationStdDev',
    'femaleFlowersPerMaleFlower', 'avgFlowersPerParent',
    'flowersPerParentStdDev', 'bufferPercentOfStdDev',
  ];

  const GT_ZERO_FIELDS: (keyof RatioFormData)[] = [
    'gramsSeedPerFruit', 'femaleFlowersPerMaleFlower', 'avgFlowersPerParent',
  ];

  const handleFormSave = async () => {
    for (const key of REQUIRED_FIELDS) {
      const v = form[key];
      if (v === null || v === undefined || v === '') {
        toast({ title: 'Validation Error', description: `${FIELD_LABELS[key]} is required.`, variant: 'destructive' });
        return;
      }
    }

    if (form.seedsPerGramOfSeed != null) {
      if (!Number.isInteger(form.seedsPerGramOfSeed) || form.seedsPerGramOfSeed < 1) {
        toast({ title: 'Validation Error', description: 'Seeds Per Gram must be an integer of 1 or higher.', variant: 'destructive' });
        return;
      }
    }

    for (const key of GT_ZERO_FIELDS) {
      const v = form[key] as number | null;
      if (v != null && v <= 0) {
        toast({ title: 'Validation Error', description: `${FIELD_LABELS[key]} must be greater than 0.`, variant: 'destructive' });
        return;
      }
    }

    for (const key of PCT_FIELDS) {
      const v = form[key] as number | null;
      if (v != null && (v <= 0 || v > 100)) {
        toast({ title: 'Validation Error', description: `${FIELD_LABELS[key]} must be above 0% and at most 100%.`, variant: 'destructive' });
        return;
      }
    }

    // Std deviations: must be >= 0 and <= corresponding mean.
    for (const { key, meanKey } of STD_DEV_PAIRS) {
      const v = form[key] as number | null;
      if (v == null) continue;
      if (v < 0) {
        toast({ title: 'Validation Error', description: `${FIELD_LABELS[key]} cannot be negative.`, variant: 'destructive' });
        return;
      }
      const mean = form[meanKey] as number | null;
      if (mean != null && v > mean) {
        toast({
          title: 'Validation Error',
          description: `${FIELD_LABELS[key]} (${v}) cannot exceed ${FIELD_LABELS[meanKey]} (${mean}).`,
          variant: 'destructive',
        });
        return;
      }
    }

    if (!editingId) {
      const duplicate = (allActiveRatios || []).find((r: Ratio) =>
        r.teamId === form.teamId && r.berryId === form.berryId && r.programId === form.programId
      );
      if (duplicate) {
        toast({ title: 'Duplicate Entry', description: 'An active ratio with this Team, Berry, and Program combination already exists.', variant: 'destructive' });
        return;
      }
    }

    // Required fields guaranteed non-null by the validation loop above.
    const payload = {
      teamId: form.teamId!,
      berryId: form.berryId!,
      programId: form.programId!,
      seedlingTransplantSuccessPercentage: displayToDec(form.seedlingTransplantSuccessPercentage) ?? undefined,
      avgSeedGerminationPercentage: displayToDec(form.avgSeedGerminationPercentage) ?? undefined,
      seedGerminationStdDev: displayToDec(form.seedGerminationStdDev) ?? undefined,
      seedSowBufferGrams: form.seedSowBufferGrams ?? undefined,
      seedsPerGramOfSeed: form.seedsPerGramOfSeed ?? undefined,
      seedNumPerGramStdDev: form.seedNumPerGramStdDev ?? undefined,
      gramsSeedPerFruit: form.gramsSeedPerFruit ?? undefined,
      gramsSeedPerFruitStdDev: form.gramsSeedPerFruitStdDev ?? undefined,
      pollinationSuccessPercentage: displayToDec(form.pollinationSuccessPercentage) ?? undefined,
      pollinationStdDev: displayToDec(form.pollinationStdDev) ?? undefined,
      femaleFlowersPerMaleFlower: form.femaleFlowersPerMaleFlower ?? undefined,
      avgFlowersPerParent: form.avgFlowersPerParent ?? undefined,
      flowersPerParentStdDev: form.flowersPerParentStdDev ?? undefined,
      bufferPercentOfStdDev: displayToDec(form.bufferPercentOfStdDev) ?? undefined,
      comments: form.comments || undefined,
      active: true,
    };

    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: payload });
        toast({ title: 'Updated', description: 'Ratio updated successfully.' });
      } else {
        await createMutation.mutateAsync({ data: payload });
        toast({ title: 'Created', description: 'New ratio created successfully.' });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/ratios'] });
      setFormOpen(false);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string }; response?: { data?: { message?: string } }; message?: string };
      const msg =
        err?.data?.message ||
        err?.response?.data?.message ||
        err?.message?.match(/:\s*(.+)$/)?.[1] ||
        err?.message ||
        'Failed to save ratio.';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteConfirm.id });
      toast({ title: 'Deleted', description: 'Ratio deleted successfully.' });
      queryClient.invalidateQueries({ queryKey: ['/api/ratios'] });
      setDeleteConfirm(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to delete ratio.', variant: 'destructive' });
    }
  };

  const setField = <K extends keyof RatioFormData>(key: K, val: RatioFormData[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const isPctField = (key: keyof RatioFormData) => PCT_FIELDS.includes(key);

  const isRequired = (key: keyof RatioFormData) => REQUIRED_FIELDS.includes(key);
  const isIntegerField = (key: keyof RatioFormData) => key === 'seedsPerGramOfSeed';
  const isGtZeroField = (key: keyof RatioFormData) => GT_ZERO_FIELDS.includes(key);

  // Lookup the std-dev → mean mapping (if any) for a field.
  const isStdDevField = (key: keyof RatioFormData) => STD_DEV_PAIRS.some(p => p.key === key);
  const meanForStdDev = (key: keyof RatioFormData): keyof RatioFormData | null =>
    STD_DEV_PAIRS.find(p => p.key === key)?.meanKey ?? null;

  // Per-field validation for inline visual feedback.
  const fieldError = (key: keyof RatioFormData): string | null => {
    const v = form[key];
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (isPctField(key)) {
      if (!isFinite(n) || n <= 0) return 'Must be greater than 0%';
      if (n > 100) return 'Cannot exceed 100%';
    } else if (isIntegerField(key)) {
      if (!Number.isInteger(n) || n < 1) return 'Must be a positive integer';
    } else if (isStdDevField(key)) {
      if (!isFinite(n) || n < 0) return 'Cannot be negative';
      const meanKey = meanForStdDev(key);
      if (meanKey) {
        const meanVal = form[meanKey];
        const meanN = typeof meanVal === 'number' ? meanVal : (meanVal != null && meanVal !== '' ? Number(meanVal) : null);
        if (meanN != null && isFinite(meanN) && n > meanN) {
          return `Cannot exceed ${FIELD_LABELS[meanKey] ?? 'the mean'} (${meanN})`;
        }
      }
    } else if (isGtZeroField(key)) {
      if (!isFinite(n) || n <= 0) return 'Must be greater than 0';
    }
    return null;
  };

  const numInput = (label: string, key: keyof RatioFormData) => {
    const err = fieldError(key);
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">{label}{isRequired(key) ? ' *' : ''}</label>
        <div className="relative">
          <input
            type="number"
            step={isIntegerField(key) ? '1' : 'any'}
            min={isPctField(key) ? 0.01 : isIntegerField(key) ? 1 : isGtZeroField(key) ? 0.0001 : undefined}
            max={isPctField(key) ? 100 : undefined}
            value={form[key] ?? ''}
            onChange={e => {
              const raw = e.target.value;
              if (raw === '') {
                setField(key, null as any);
                return;
              }
              let n = isIntegerField(key) ? parseInt(raw) : parseFloat(raw);
              if (!Number.isFinite(n)) {
                setField(key, null as any);
                return;
              }
              // Clamp percent fields hard so invalid values can never enter state.
              if (isPctField(key)) {
                if (n > 100) n = 100;
                // Negative values and 0 are invalid but we still let the user
                // see what they typed so the inline error message makes sense;
                // submit is gated separately.
              }
              setField(key, n as any);
            }}
            className={`w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 outline-none ${
              err ? 'border-destructive focus:ring-destructive' : 'focus:ring-primary'
            } ${isPctField(key) ? 'pr-7' : ''}`}
            aria-invalid={!!err}
          />
          {isPctField(key) && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>}
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    );
  };

  // Aggregate validity across all numeric fields — used to gate the Save button.
  const formHasErrors = (): boolean => {
    const allKeys: (keyof RatioFormData)[] = [
      ...PCT_FIELDS,
      ...GT_ZERO_FIELDS,
      ...STD_DEV_PAIRS.map(p => p.key),
      'seedsPerGramOfSeed',
    ];
    return allKeys.some(k => fieldError(k) !== null);
  };

  // True when every required field has a non-empty value.  Drives the Save
  // button's disabled state alongside formHasErrors().
  const allRequiredFilled = (): boolean =>
    REQUIRED_FIELDS.every(k => {
      const v = form[k];
      return v !== null && v !== undefined && v !== '';
    });

  const [resetPageSignal, setResetPageSignal] = useState(0);
  const resetFilters = () => {
    setProgramIds([]);
      setResetPageSignal(s => s + 1);
  };

  const { data: filterPrograms } = useListPrograms({ berryId: filters.berryId, active: true });

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{t('reference.ratios.title')}</h1>
            <p className="text-muted-foreground mt-1">{t('reference.ratios.description')}</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={handleNew} className="gap-1.5 rounded-lg">
              <Plus className="w-3.5 h-3.5" /> New Ratio
            </Button>
          )}
        </div>

        <div className="bg-card px-4 py-3 rounded-2xl border shadow-sm flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filters</h3>
          <MultiSelect
            value={programIds}
            onChange={setProgramIds}
            options={(filterPrograms || []).map((p: any) => ({ value: p.id, label: p.srcBreedingProgram }))}
            placeholder="All Programs"
            className="w-52"
          />
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>

        <DataTable
          resetPageSignal={resetPageSignal}
          data={rows}
          columns={columns}
          title="Propagation Ratios"
          rowKey="id"
        />
      </div>

      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onMouseDown={onBackdropMouseDown}
          onClick={onBackdropClick(() => setFormOpen(false))}
        >
          <div className="bg-card rounded-2xl border shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-card z-10">
              <h3 className="font-semibold text-lg text-foreground">
                {editingId ? 'Edit Ratios' : 'New Ratio Entry'}
              </h3>
              <button onClick={() => setFormOpen(false)} className="p-1 rounded-lg hover:bg-secondary/20">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-3 gap-4">
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
                {numInput('Seedling Transplant Success %', 'seedlingTransplantSuccessPercentage')}
                {numInput('Avg Seed Germination %', 'avgSeedGerminationPercentage')}
                {numInput('Seed Germ Std Dev', 'seedGerminationStdDev')}
                {numInput('Seed Sow Buffer (g)', 'seedSowBufferGrams')}
                {numInput('Seeds Per Gram', 'seedsPerGramOfSeed')}
                {numInput('Seeds/Gram Std Dev', 'seedNumPerGramStdDev')}
              </div>

              <div className="grid grid-cols-6 gap-3">
                {numInput('Grams Seed Per Fruit', 'gramsSeedPerFruit')}
                {numInput('Seed g/Fruit Std Dev', 'gramsSeedPerFruitStdDev')}
                {numInput('Pollination Success %', 'pollinationSuccessPercentage')}
                {numInput('Pollination Std Dev', 'pollinationStdDev')}
                {numInput('Female Flowers/Male', 'femaleFlowersPerMaleFlower')}
                {numInput('Avg Flowers Per Parent', 'avgFlowersPerParent')}
              </div>

              <div className="grid grid-cols-6 gap-3">
                {numInput('Flowers/Parent Std Dev', 'flowersPerParentStdDev')}
                {numInput('Buffer % of Std Dev', 'bufferPercentOfStdDev')}
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
                  createMutation.isPending || updateMutation.isPending
                  || !allRequiredFilled() || formHasErrors()
                }
              >
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onMouseDown={onBackdropMouseDown}
          onClick={onBackdropClick(() => setDeleteConfirm(null))}
        >
          <div className="bg-card rounded-2xl border shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-foreground">Delete Ratio</h3>
              <button onClick={() => setDeleteConfirm(null)} className="p-1 rounded-lg hover:bg-secondary/20">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to delete the ratio for <strong>{deleteConfirm.name}</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2 px-1">
        <PropCalcsPanel />
        <PropCalcsCalculator ratios={rows as any} />
      </div>
    </Layout>
  );
}
