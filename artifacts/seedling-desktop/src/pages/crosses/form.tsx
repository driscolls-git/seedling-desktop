import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FilterContext';
import {
  useGetCross, useCreateCross, useUpdateCross,
  useListSelections, useListLocations, useListPrograms,
  useListTrays, useListLabs, useListMarkers, useListTransplantInstructions,
  useListTeams, useListBerries, useListRatios, useListDeadlines,
  CrossInput,
} from '@workspace/api-client-react';
import { Save, Loader2, X } from 'lucide-react';
import { PropCalcsPanel } from '@/components/ui/PropCalcsPanel';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

function SearchableSelect({
  value, onChange, options, placeholder, label, disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  // Cap render size so very large option sets (e.g. parent selections — can
  // be thousands) don't push thousands of DOM nodes when the dropdown opens.
  // Locations have ~73 active rows, so anything below ~75 cuts them off mid-
  // alphabet (e.g. Salinas ~ #49, Watsonville ~ #64).  200 covers locations
  // comfortably and is still trivial to render for the parent dropdowns.
  const filtered = useMemo(() => {
    if (!search) return options.slice(0, 200);
    const lower = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(lower)).slice(0, 200);
  }, [options, search]);

  return (
    <div className="relative">
      {label && <label className="block text-sm font-medium mb-1">{label}</label>}
      <input
        type="text"
        value={open ? search : value || ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => { if (disabled) return; setSearch(e.target.value); setOpen(true); }}
        onFocus={() => { if (disabled) return; setOpen(true); setSearch(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-1 focus:ring-primary outline-none disabled:bg-muted/40 disabled:text-muted-foreground disabled:cursor-not-allowed"
      />
      {!disabled && open && filtered.length > 0 && (
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

function FormField({ label, children, span }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div className={span ? `col-span-${span}` : ''}>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {children}
    </div>
  );
}

function toDateInputValue(isoOrDate: string | undefined | null): string {
  if (!isoOrDate) return '';
  return isoOrDate.substring(0, 10);
}

export default function CrossForm() {
  const { t } = useTranslation();
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const crossId = params.get('id') ? Number(params.get('id')) : undefined;
  const copyId = params.get('copy') ? Number(params.get('copy')) : undefined;
  const isEdit = !!crossId;
  const isCopy = !!copyId;

  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { isBreeder, user } = useAuth();
  const { filters } = useFilters();
  const { toast } = useToast();

  useEffect(() => {
    if (!isBreeder && !isEdit && !isCopy) {
      navigate('/crosses/short');
    }
  }, [isBreeder, isEdit, isCopy, navigate]);

  const loadId = crossId || copyId;
  const { data: existingCross, isLoading: loadingCross } = useGetCross(loadId!, { query: { queryKey: ['/api/crosses', loadId], enabled: !!loadId } });
  const { data: locations } = useListLocations({ active: true });
  const { data: trays } = useListTrays();
  const { data: labs } = useListLabs();
  const { data: markers } = useListMarkers();
  const { data: transplantInstructions } = useListTransplantInstructions();
  const { data: teams } = useListTeams();
  const { data: berries } = useListBerries();

  const createCross = useCreateCross();
  const updateCross = useUpdateCross();

  const isNew = !isEdit && !isCopy;
  // For new crosses, default Berry and Team from the global filters (top of app)
  // and Cross Designed By to the current user's name.
  const [form, setForm] = useState<Partial<CrossInput>>({
    progeny: '',
    crossDesignedBy: isNew ? (user?.ghEmployee ?? '') : undefined,
    berryId: isNew ? (filters.berryId ?? undefined) : undefined,
    teamId: isNew ? (filters.teamId ?? undefined) : undefined,
    expectedDiscardPercentage: 0,
    spinelessDiscardPercentage: 0,
  });

  const programBerryId = form.berryId ?? filters.berryId;
  const { data: programs } = useListPrograms({ berryId: programBerryId, active: true });

  // Parent dropdown options come from T_GHParentInventory2 narrowed to the
  // (berry, year, team) combo selected on the form.  Only fetch when all
  // three are set — otherwise the dropdown stays disabled with a helper note.
  const parentFiltersReady = !!(form.berryId && form.pollinationYear && form.teamId);
  const { data: selections } = useListSelections(
    {
      active: true,
      berryId: form.berryId,
      pollinationYear: form.pollinationYear,
      teamId: form.teamId,
    },
    {
      query: {
        queryKey: ['/api/selections', form.berryId, form.pollinationYear, form.teamId],
        enabled: parentFiltersReady,
      },
    },
  );

  const { data: ratiosData } = useListRatios(
    { berryId: form.berryId, programId: form.d1ProgramId, teamId: form.teamId, active: true },
    { query: { queryKey: ['/api/ratios', form.berryId, form.d1ProgramId, form.teamId], enabled: !!(form.berryId && form.d1ProgramId && form.teamId) } }
  );
  const ratioId = ratiosData?.[0]?.id ?? null;

  const destLocationId = useMemo(() => {
    if (!form.destination1 || !locations) return undefined;
    const loc = locations.find((l: any) => l.locationName === form.destination1);
    return loc?.id;
  }, [form.destination1, locations]);

  const { data: deadlinesData } = useListDeadlines(
    { berryId: form.berryId, programId: form.d1ProgramId, teamId: form.teamId, destinationId: destLocationId },
    { query: { queryKey: ['/api/deadlines', form.berryId, form.d1ProgramId, form.teamId, destLocationId], enabled: !!(form.berryId && form.d1ProgramId && form.teamId && destLocationId) } }
  );
  const deadlineId = deadlinesData?.[0]?.id ?? null;

  // When berry switches away from Blackberry, force Spiny Discard back to 0
  // so a stale non-zero value can't slip through on save.
  useEffect(() => {
    const selectedBerry = berries?.find((b: any) => b.id === form.berryId);
    const isBlackberry = !!selectedBerry?.berryType?.toUpperCase().startsWith('BLACK');
    if (!isBlackberry && form.spinelessDiscardPercentage !== 0) {
      update('spinelessDiscardPercentage', 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.berryId, berries]);

  useEffect(() => {
    if (existingCross && (isEdit || isCopy)) {
      const ec = existingCross as any;

      const resolvedTeamId = ec.teamId
        ?? (ec.teamName && teams ? (teams as any[]).find(t => t.teamName === ec.teamName)?.id : undefined);

      const resolvedD1ProgramId = ec.d1ProgramId
        ?? (ec.d1Program && programs ? (programs as any[]).find(p => p.srcBreedingProgram === ec.d1Program)?.id : undefined);

      const resolvedD2ProgramId = ec.d2ProgramId
        ?? (ec.d2Program && programs ? (programs as any[]).find(p => p.srcBreedingProgram === ec.d2Program)?.id : undefined);

      const resolvedTraySize = typeof ec.traySize === 'number' && trays
        ? ((trays as any[]).find(t => t.id === ec.traySize)?.id
          ?? (trays as any[]).find(t => t.traySize === ec.traySize)?.id)
        : ec.traySize;

      setForm({
        progeny: isCopy ? '' : existingCross.progeny,
        parent1: existingCross.parent1,
        parent2: existingCross.parent2,
        destination1: existingCross.destination1,
        destination2: existingCross.destination2,
        d1ProgramId: resolvedD1ProgramId,
        d2ProgramId: resolvedD2ProgramId,
        d1SeedlingShipRequest: existingCross.d1SeedlingShipRequest,
        d2SeedlingShipRequest: existingCross.d2SeedlingShipRequest,
        breederRequestedShipDest1Adjustments: existingCross.breederRequestedShipDest1Adjustments,
        breederRequestedShipDest2Adjustments: existingCross.breederRequestedShipDest2Adjustments,
        d1FieldPlantDate: toDateInputValue(existingCross.d1FieldPlantDate),
        d2FieldPlantDate: toDateInputValue(existingCross.d2FieldPlantDate),
        requestedFieldPlantYear: existingCross.requestedFieldPlantYear,
        // DB stores percentages as decimals (0.75 for 75%); form displays the
        // user-facing percentage (75).  Multiply on load.
        expectedDiscardPercentage: existingCross.expectedDiscardPercentage != null
          ? Math.round(existingCross.expectedDiscardPercentage * 100 * 1e6) / 1e6
          : existingCross.expectedDiscardPercentage,
        spinelessDiscardPercentage: existingCross.spinelessDiscardPercentage != null
          ? Math.round(existingCross.spinelessDiscardPercentage * 100 * 1e6) / 1e6
          : existingCross.spinelessDiscardPercentage,
        transplantInstructions: existingCross.transplantInstructions,
        traySize: resolvedTraySize,
        screening: existingCross.screening,
        sortByMarkerGroup: !!existingCross.sortByMarkerGroup,
        testingLab1: existingCross.testingLab1,
        testingLab2: existingCross.testingLab2,
        totalMarker: existingCross.totalMarker,
        marker1: existingCross.marker1,
        marker2: existingCross.marker2,
        marker3: existingCross.marker3,
        marker4: existingCross.marker4,
        marker5: existingCross.marker5,
        marker6: existingCross.marker6,
        spCrosses: existingCross.spCrosses,
        pollinationYear: existingCross.pollinationYear,
        berryId: existingCross.berryId,
        teamId: resolvedTeamId,
        reciprocalAllowed: existingCross.reciprocalAllowed,
        bulkParent3: existingCross.bulkParent3,
        crossDesignedBy: existingCross.crossDesignedBy,
        breederComments: existingCross.breederComments,
        ghTeamComments: existingCross.ghTeamComments,
        fumigated: existingCross.fumigated,
        sowSeed: existingCross.sowSeed,
      });
    }
  }, [existingCross, isEdit, isCopy, teams, programs, trays]);

  const update = (key: keyof CrossInput, value: any) => setForm(f => ({ ...f, [key]: value }));

  const selectionOptions = useMemo(() =>
    (selections || []).map(s => ({ value: s.selection, label: s.selection })),
    [selections]
  );

  const locationOptions = useMemo(() =>
    (locations || []).map(l => ({ value: l.locationName, label: l.locationName })),
    [locations]
  );

  const teamOptions = useMemo(() =>
    (teams || []).map((t: any) => ({ value: t.id, label: t.teamName || t.name })),
    [teams]
  );

  const berryOptions = useMemo(() =>
    (berries || []).map((b: any) => ({ value: b.id, label: b.berryType })),
    [berries]
  );

  const labOptions = useMemo(() =>
    (labs || []).map((l: any) => ({ value: l.labName, label: l.labName })),
    [labs]
  );

  const markerOptions = useMemo(() => {
    const seen = new Set<string>();
    return (markers || [])
      .filter((m: any) => m.markerAliasDriscolls && (!form.berryId || m.berryId === form.berryId) && !seen.has(m.markerAliasDriscolls) && seen.add(m.markerAliasDriscolls))
      .map((m: any) => ({ value: m.markerAliasDriscolls, label: m.markerAliasDriscolls }));
  }, [markers, form.berryId]);

  const transplantOptions = useMemo(() =>
    (transplantInstructions || []).map((t: any) => ({ value: t.transplantInstruct, label: t.transplantInstruct })),
    [transplantInstructions]
  );

  const computedTotalMarker = useMemo(() => {
    let count = 0;
    for (let n = 1; n <= 6; n++) {
      if ((form as any)[`marker${n}`]) count++;
    }
    return count;
  }, [form.marker1, form.marker2, form.marker3, form.marker4, form.marker5, form.marker6]);

  const requiredMissing = !form.parent1 || !form.parent2 || !form.destination1
    || !form.d1ProgramId || !form.d1SeedlingShipRequest || !form.d1FieldPlantDate
    || form.expectedDiscardPercentage == null || form.spinelessDiscardPercentage == null
    || !form.traySize || !form.crossDesignedBy?.trim();
  const screeningRequired = form.screening && (!form.testingLab1 || !form.marker1);

  const handleSave = () => {
    // requestedFieldPlantYear is a calculated column — don't send it; the server derives it.
    const { requestedFieldPlantYear: _ignored, ...rest } = form;
    // Percent fields: form holds user-facing percentage (75); DB stores decimal
    // (0.75).  Divide on the way out.  Without this the column ends up storing
    // 75 verbatim, then the list page does value*100 for display and shows 7500%.
    const expDec = rest.expectedDiscardPercentage != null ? rest.expectedDiscardPercentage / 100 : rest.expectedDiscardPercentage;
    const spineDec = rest.spinelessDiscardPercentage != null ? rest.spinelessDiscardPercentage / 100 : rest.spinelessDiscardPercentage;
    const data = {
      ...rest,
      expectedDiscardPercentage: expDec,
      spinelessDiscardPercentage: spineDec,
      progeny: form.progeny || '',
      totalMarker: computedTotalMarker,
    } as CrossInput;
    if (isEdit && crossId) {
      updateCross.mutate({ id: crossId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/crosses'] });
          toast({ title: 'Updated', description: 'Cross updated successfully.' });
          navigate('/crosses/short');
        },
        onError: (error: unknown) => {
          const err = error as any;
          const msg = err?.data?.message || err?.response?.data?.message || (err?.message?.match(/:\s*(.+)$/)?.[1]) || err?.message || 'Failed to update cross.';
          toast({ title: 'Error', description: msg, variant: 'destructive' });
        },
      });
    } else {
      createCross.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/crosses'] });
          toast({ title: 'Created', description: 'New cross created successfully.' });
          navigate('/crosses/short');
        },
        onError: (error: unknown) => {
          const err = error as any;
          const msg = err?.data?.message || err?.response?.data?.message || (err?.message?.match(/:\s*(.+)$/)?.[1]) || err?.message || 'Failed to create cross.';
          toast({ title: 'Error', description: msg, variant: 'destructive' });
        },
      });
    }
  };

  const isSaving = createCross.isPending || updateCross.isPending;

  if ((isEdit || isCopy) && loadingCross) {
    return (
      <Layout>
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  const inp = "w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-1 focus:ring-primary outline-none";
  const selectInp = "w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-1 focus:ring-primary outline-none";

  const showRatioError = !!(form.berryId && form.d1ProgramId && form.teamId && ratiosData && ratioId === null);
  const showDeadlineError = !!(form.berryId && form.d1ProgramId && form.teamId && destLocationId && deadlinesData && deadlineId === null);

  return (
    <Layout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground">
                {isEdit ? `Edit Cross — ${existingCross?.progeny}` : isCopy ? `Copy Cross — ${existingCross?.progeny}` : 'New Cross'}
              </h1>
              <p className="text-muted-foreground mt-1">
                {isEdit ? 'Update the cross record details.' : isCopy ? 'Creating a new cross from a copy. Enter a unique Progeny name.' : 'Create a new cross record.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate('/crosses/short')}
              disabled={isSaving}
              className="gap-1.5 rounded-lg"
            >
              <X className="w-4 h-4" /> Cancel
            </Button>
            {isBreeder && (
              <Button onClick={handleSave} disabled={isSaving || !form.progeny || requiredMissing || !!screeningRequired || showRatioError || showDeadlineError} className="gap-1.5 rounded-lg">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isEdit ? 'Save Changes' : isCopy ? 'Create Copy' : 'Create Cross'}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <section className="bg-card rounded-2xl border p-6 space-y-4">
            <h2 className="text-lg font-semibold font-display border-b pb-2">Cross Info</h2>
            <div className="grid grid-cols-4 gap-4">
              <FormField label="Berry *">
                <select
                  value={form.berryId ?? ''}
                  onChange={e => {
                    const val = e.target.value ? Number(e.target.value) : undefined;
                    update('berryId', val);
                    update('d1ProgramId', undefined);
                    update('d2ProgramId', undefined);
                    if (isNew && val) {
                      const berryName = berryOptions.find(b => b.value === val)?.label?.toUpperCase() || '';
                      const defaultSize = (berryName === 'BLUE' || berryName === 'RASP' || berryName === 'BLACK') ? 38 : berryName === 'STRAW' ? 50 : undefined;
                      if (defaultSize && trays) {
                        const matchingTray = (trays as any[]).find(t => (t.traySize ?? t.trayName) === defaultSize);
                        if (matchingTray) update('traySize', matchingTray.id);
                      }
                    }
                  }}
                  disabled={isEdit}
                  className={selectInp}
                >
                  <option value="">Select...</option>
                  {berryOptions.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </FormField>
              <FormField label="Progeny *">
                <Input
                  value={form.progeny || ''}
                  onChange={e => update('progeny', e.target.value)}
                  placeholder="Enter progeny name"
                  disabled={isEdit}
                />
              </FormField>
              <FormField label="Pollination Year *">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={form.pollinationYear ?? ''}
                  onChange={e => {
                    // Allow only digits, cap at 4 characters.
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                    update('pollinationYear', digits ? Number(digits) : undefined);
                  }}
                  disabled={isEdit}
                  className={inp}
                />
              </FormField>
              <FormField label="Pollination Team *">
                <select
                  value={form.teamId ?? ''}
                  onChange={e => update('teamId', e.target.value ? Number(e.target.value) : undefined)}
                  disabled={isEdit}
                  className={selectInp}
                >
                  <option value="">Select...</option>
                  {teamOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Parent 1 *">
                <SearchableSelect value={form.parent1 || ''} onChange={v => update('parent1', v)} options={selectionOptions} placeholder={t('filters.searchParent')} disabled={!parentFiltersReady} />
              </FormField>
              <FormField label="Parent 2 *">
                <SearchableSelect value={form.parent2 || ''} onChange={v => update('parent2', v)} options={selectionOptions} placeholder={t('filters.searchParent')} disabled={!parentFiltersReady} />
              </FormField>
              <FormField label="Bulk Parent 3">
                <SearchableSelect value={form.bulkParent3 || ''} onChange={v => update('bulkParent3', v)} options={selectionOptions} placeholder={t('filters.searchParent')} disabled={!parentFiltersReady} />
              </FormField>
            </div>
            {!parentFiltersReady ? (
              <p className="text-xs text-amber-600 -mt-2">
                Select <strong>Berry</strong>, <strong>Pollination Year</strong>, and <strong>Pollination Team</strong> first to enable the parent dropdowns.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground -mt-2">
                Showing selections from Parent Inventory for the chosen Berry, Pollination Year, and Team. If the selection you want isn't listed, add it to the <strong>Parent Inventory</strong> first.
              </p>
            )}
            <div className="grid grid-cols-4 gap-4">
              <FormField label="Reciprocal Allowed">
                <label className="flex items-center gap-2 py-2">
                  <input type="checkbox" checked={!!form.reciprocalAllowed} onChange={e => update('reciprocalAllowed', e.target.checked)} className="rounded" />
                  <span className="text-sm">{form.reciprocalAllowed ? 'Yes' : 'No'}</span>
                </label>
              </FormField>
              <FormField label="SP Crosses">
                <label className="flex items-center gap-2 py-2">
                  <input type="checkbox" checked={!!form.spCrosses} onChange={e => update('spCrosses', e.target.checked)} className="rounded" />
                  <span className="text-sm">SP Cross</span>
                </label>
              </FormField>
              <FormField label="Cross Designed By *">
                <input type="text" value={form.crossDesignedBy ?? ''} onChange={e => update('crossDesignedBy', e.target.value || undefined)} className={inp} />
              </FormField>
            </div>

            {(showRatioError || showDeadlineError) && (
              <div className="flex gap-4">
                {showRatioError && (
                  <p className="text-sm text-destructive font-medium">No Ratio Found for this Berry/Program/Team combination.</p>
                )}
                {showDeadlineError && (
                  <p className="text-sm text-destructive font-medium">No Deadline Found for this Berry/Program/Team/Destination combination.</p>
                )}
              </div>
            )}

          </section>

          <section className="bg-card rounded-2xl border p-6 space-y-4">
            <h2 className="text-lg font-semibold font-display border-b pb-2">Destinations & Shipping</h2>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4 p-4 bg-secondary/5 rounded-xl">
                <h3 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">Destination 1</h3>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Location *">
                    <SearchableSelect value={form.destination1 || ''} onChange={v => update('destination1', v)} options={locationOptions} placeholder="Select destination..." />
                  </FormField>
                  <FormField label="Program *">
                    <select value={form.d1ProgramId ?? ''} onChange={e => update('d1ProgramId', e.target.value ? Number(e.target.value) : undefined)} className={selectInp}>
                      <option value="">Select...</option>
                      {(programs || []).map(p => <option key={p.id} value={p.id}>{p.srcBreedingProgram}</option>)}
                    </select>
                  </FormField>
                  <FormField label={isEdit ? "Ship Request" : "Ship Request *"}>
                    <input type="number" value={form.d1SeedlingShipRequest ?? ''} onChange={e => update('d1SeedlingShipRequest', e.target.value ? Number(e.target.value) : undefined)} className={inp} readOnly={isEdit} tabIndex={isEdit ? -1 : undefined} style={isEdit ? { opacity: 0.6, cursor: 'not-allowed' } : undefined} />
                  </FormField>
                  <FormField label="Ship Adj +/-">
                    <input type="number" value={form.breederRequestedShipDest1Adjustments ?? ''} onChange={e => update('breederRequestedShipDest1Adjustments', e.target.value ? Number(e.target.value) : undefined)} className={inp} />
                  </FormField>
                  <FormField label="Field Plant Date *">
                    <input type="date" value={toDateInputValue(form.d1FieldPlantDate)} onChange={e => update('d1FieldPlantDate', e.target.value || undefined)} className={inp} />
                  </FormField>
                </div>
              </div>
              <div className="space-y-4 p-4 bg-secondary/5 rounded-xl">
                <h3 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">Destination 2</h3>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Location">
                    <SearchableSelect value={form.destination2 || ''} onChange={v => update('destination2', v)} options={locationOptions} placeholder="Select destination..." />
                  </FormField>
                  <FormField label="Program">
                    <select value={form.d2ProgramId ?? ''} onChange={e => update('d2ProgramId', e.target.value ? Number(e.target.value) : undefined)} className={selectInp}>
                      <option value="">Select...</option>
                      {(programs || []).map(p => <option key={p.id} value={p.id}>{p.srcBreedingProgram}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Ship Request">
                    <input type="number" value={form.d2SeedlingShipRequest ?? ''} onChange={e => update('d2SeedlingShipRequest', e.target.value ? Number(e.target.value) : undefined)} className={inp} readOnly={isEdit} tabIndex={isEdit ? -1 : undefined} style={isEdit ? { opacity: 0.6, cursor: 'not-allowed' } : undefined} />
                  </FormField>
                  <FormField label="Ship Adj +/-">
                    <input type="number" value={form.breederRequestedShipDest2Adjustments ?? ''} onChange={e => update('breederRequestedShipDest2Adjustments', e.target.value ? Number(e.target.value) : undefined)} className={inp} />
                  </FormField>
                  <FormField label="Field Plant Date">
                    <input type="date" value={toDateInputValue(form.d2FieldPlantDate)} onChange={e => update('d2FieldPlantDate', e.target.value || undefined)} className={inp} />
                  </FormField>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-card rounded-2xl border p-6 space-y-4">
            <h2 className="text-lg font-semibold font-display border-b pb-2">Propagation</h2>
            <div className="grid grid-cols-4 gap-4">
              <FormField label="Expected Discard % *">
                <input type="number" min={0} max={99} value={form.expectedDiscardPercentage ?? ''} onChange={e => {
                  const v = e.target.value ? Math.min(99, Math.max(0, Number(e.target.value))) : undefined;
                  update('expectedDiscardPercentage', v);
                }} className={inp} />
              </FormField>
              <FormField label="Spiny Discard % *">
                {(() => {
                  // Spiny Discard only applies to blackberries (BLACK).  For
                  // any other berry the field is locked to 0 and read-only.
                  const selectedBerry = berries?.find((b: any) => b.id === form.berryId);
                  const isBlackberry = selectedBerry?.berryType?.toUpperCase().startsWith('BLACK');
                  return (
                    <input
                      type="number"
                      min={0}
                      max={99}
                      readOnly={!isBlackberry}
                      value={isBlackberry ? (form.spinelessDiscardPercentage ?? '') : 0}
                      onChange={e => {
                        if (!isBlackberry) return;
                        const v = e.target.value ? Math.min(99, Math.max(0, Number(e.target.value))) : undefined;
                        update('spinelessDiscardPercentage', v);
                      }}
                      className={`${inp} ${!isBlackberry ? 'bg-muted/40 text-muted-foreground cursor-not-allowed' : ''}`}
                      title={!isBlackberry ? 'Spiny Discard only applies to Blackberry crosses' : undefined}
                    />
                  );
                })()}
              </FormField>
              <FormField label="Transplant Instructions">
                <select value={form.transplantInstructions ?? ''} onChange={e => update('transplantInstructions', e.target.value || undefined)} className={selectInp}>
                  <option value="">Select...</option>
                  {transplantOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </FormField>
              <FormField label="Tray Size *">
                <select value={form.traySize ?? ''} onChange={e => update('traySize', e.target.value ? Number(e.target.value) : undefined)} className={selectInp}>
                  <option value="">Select...</option>
                  {(trays || []).map(t => <option key={t.id} value={t.id}>{(t as any).trayName || (t as any).traySize || t.id}</option>)}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <FormField label="Sow Seed">
                <label className="flex items-center gap-2 py-2">
                  <input type="checkbox" checked={form.sowSeed !== false} onChange={e => update('sowSeed', e.target.checked)} className="rounded" />
                  <span className="text-sm">{form.sowSeed !== false ? 'Yes' : 'No'}</span>
                </label>
              </FormField>
              <FormField label="Fumigated">
                <label className="flex items-center gap-2 py-2">
                  <input type="checkbox" checked={!!form.fumigated} onChange={e => update('fumigated', e.target.checked)} className="rounded" />
                  <span className="text-sm">{form.fumigated ? 'Yes' : 'No'}</span>
                </label>
              </FormField>
              <FormField label="Screening">
                <label className="flex items-center gap-2 py-2">
                  <input type="checkbox" checked={!!form.screening} onChange={e => update('screening', e.target.checked)} className="rounded" />
                  <span className="text-sm">Requires Screening</span>
                </label>
              </FormField>
            </div>
          </section>

          <section className="bg-card rounded-2xl border p-6 space-y-4">
            <h2 className="text-lg font-semibold font-display border-b pb-2">Markers</h2>
            <div className="grid grid-cols-4 gap-4">
              <FormField label="Sort by Marker Group">
                <label className="flex items-center gap-2 py-2">
                  <input type="checkbox" checked={!!form.sortByMarkerGroup} onChange={e => update('sortByMarkerGroup', e.target.checked)} className="rounded" />
                  <span className="text-sm">{form.sortByMarkerGroup ? 'Yes' : 'No'}</span>
                </label>
              </FormField>
              <FormField label="Total Markers">
                <input type="number" value={computedTotalMarker} readOnly className={inp + " bg-muted cursor-not-allowed"} />
              </FormField>
              <FormField label={form.screening ? "Testing Lab 1 *" : "Testing Lab 1"}>
                <select value={form.testingLab1 ?? ''} onChange={e => update('testingLab1', e.target.value || undefined)} className={selectInp}>
                  <option value="">Select...</option>
                  {labOptions.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </FormField>
              <FormField label="Testing Lab 2">
                <select value={form.testingLab2 ?? ''} onChange={e => update('testingLab2', e.target.value || undefined)} className={selectInp}>
                  <option value="">Select...</option>
                  {labOptions.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-6 gap-3">
              {([1, 2, 3, 4, 5, 6] as const).map(n => (
                <FormField key={n} label={n === 1 && form.screening ? `Marker ${n} *` : `Marker ${n}`}>
                  <select value={(form as any)[`marker${n}`] ?? ''} onChange={e => update(`marker${n}` as keyof CrossInput, e.target.value || undefined)} className={selectInp}>
                    <option value="">Select...</option>
                    {markerOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </FormField>
              ))}
            </div>
          </section>

          <section className="bg-card rounded-2xl border p-6 space-y-4">
            <h2 className="text-lg font-semibold font-display border-b pb-2">Comments</h2>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Breeder Comments">
                <textarea
                  value={form.breederComments ?? ''}
                  onChange={e => update('breederComments', e.target.value || undefined)}
                  className={inp + " min-h-[80px] resize-y"}
                  rows={3}
                />
              </FormField>
              <FormField label="GH Team Comments">
                <textarea
                  value={form.ghTeamComments ?? ''}
                  onChange={e => update('ghTeamComments', e.target.value || undefined)}
                  className={inp + " min-h-[80px] resize-y"}
                  rows={3}
                />
              </FormField>
            </div>
          </section>

          {isEdit && existingCross && (
            <section className="bg-card rounded-2xl border p-6 space-y-4">
              <h2 className="text-lg font-semibold font-display border-b pb-2">Propagation Summary (Read-Only)</h2>
              <div className="grid grid-cols-4 gap-4 text-sm">
                {[
                  ['Total Ship Req', existingCross.totalSeedlingShipRequestCalc],
                  ['Est Plants to Ship', existingCross.estimatedPlantsToShip],
                  ['Transplants Required', existingCross.transplantsRequired],
                  ['Transplants Done', existingCross.plantNumTransplanted],
                  ['Extra Transplants', existingCross.extraTransplants],
                  ['Seed Wt Required', existingCross.seedWeightRequired],
                  ['Seed Wt Inventory', existingCross.seedWeightInventory],
                  ['Seed Wt Sown', existingCross.totalSeedWeightSown],
                  ['Flowers to Pollinate Req', existingCross.flowersToPollinateRequired],
                  ['Successful Pollinations', existingCross.successfulPollinations],
                  ['P1 Total Parents', existingCross.p1TotalParents],
                  ['P2 Total Parents', existingCross.p2TotalParents],
                ].map(([label, val]) => (
                  <div key={label as string} className="bg-secondary/5 rounded-lg p-3">
                    <p className="text-muted-foreground text-xs">{label}</p>
                    <p className="font-semibold">{val ?? '—'}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <PropCalcsPanel />
      </div>
    </Layout>
  );
}
