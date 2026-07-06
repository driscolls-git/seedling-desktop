import React, { useState, useMemo } from 'react';
import { Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '\./button';

interface DeadlineRow {
  id: number;
  berryType?: string;
  teamName?: string;
  destination?: string;
  srcBreedingProgram?: string;
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
}

interface Props {
  deadlines: DeadlineRow[];
}

function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + weeks * 7);
  return result;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STEPS: { label: string; key: keyof DeadlineRow }[] = [
  { label: 'Crossing File Deadline', key: 'crossingFileDeadline' },
  { label: 'Pollination Start', key: 'pollinationStart' },
  { label: 'Pollination Deadline', key: 'pollinationDeadline' },
  { label: 'Fruit Collect Start', key: 'fruitCollectStart' },
  { label: 'Fruit Collect Deadline', key: 'fruitCollectDeadline' },
  { label: 'Seed Acid Start', key: 'seedAcidStart' },
  { label: 'Seed Acid Deadline', key: 'seedAcidDeadline' },
  { label: 'Seed Sow Start', key: 'seedSowStart' },
  { label: 'Seed Sow Deadline', key: 'seedSowDeadline' },
  { label: 'Transplant Start', key: 'transplantStart' },
  { label: 'Transplant Deadline', key: 'transplantDeadline' },
  { label: 'Marker Screen Start', key: 'markerScreenStart' },
  { label: 'Marker Screen Deadline', key: 'markerScreenDeadline' },
  { label: 'Marker Results Deadline', key: 'markerResultsDeadline' },
];

export function DeadlineCalcExample({ deadlines }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [fieldPlantDate, setFieldPlantDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });

  const selectedDeadline = useMemo(
    () => deadlines.find(d => d.id === selectedId) ?? null,
    [deadlines, selectedId]
  );

  const computedDates = useMemo(() => {
    if (!selectedDeadline || !fieldPlantDate) return null;
    const baseDate = new Date(fieldPlantDate + 'T00:00:00');
    return STEPS.map(step => {
      const weeks = selectedDeadline[step.key] as number | null;
      if (weeks == null) return { label: step.label, weeks: null, date: null };
      return { label: step.label, weeks, date: addWeeks(baseDate, weeks) };
    });
  }, [selectedDeadline, fieldPlantDate]);

  return (
    <div className="mt-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="gap-2"
      >
        <Calendar className="w-4 h-4" />
        Deadline Date Example
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </Button>

      {open && (
        <div className="mt-3 border rounded-xl p-5 bg-card space-y-5">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              See how deadline week offsets translate to actual dates
            </p>
            <p className="text-xs text-muted-foreground">
              Select a deadline row and a field plant date to see the calculated dates for each propagation step.
            </p>
          </div>

          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1 flex-1 min-w-[240px] max-w-md">
              <label className="text-xs font-medium text-muted-foreground">Deadline Row</label>
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value ? parseInt(e.target.value) : '')}
                className="w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
              >
                <option value="">Select a deadline row...</option>
                {deadlines.map(d => (
                  <option key={d.id} value={d.id}>
                    {[d.berryType, d.teamName, d.destination, d.srcBreedingProgram].filter(Boolean).join(' / ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Field Plant Date</label>
              <input
                type="date"
                value={fieldPlantDate}
                onChange={e => setFieldPlantDate(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
              />
            </div>
          </div>

          {selectedDeadline && computedDates && (
            <div className="overflow-x-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 min-w-0">
                {computedDates.map(item => (
                  <div key={item.label} className="bg-muted/30 border rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1 leading-tight">{item.label}</p>
                    {item.date ? (
                      <>
                        <p className="text-sm font-semibold text-foreground">{formatDate(item.date)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">({item.weeks} wks)</p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!selectedDeadline && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Select a deadline row above to see calculated dates.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
