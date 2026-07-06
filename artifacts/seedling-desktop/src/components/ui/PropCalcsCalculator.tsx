import React, { useState, useMemo } from 'react';
import { Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '\./button';
import { cn } from '@/lib/utils';

interface RatioValues {
  seedlingTransplantSuccessPercentage: number | null;
  avgSeedGerminationPercentage: number | null;
  seedGerminationStdDev: number | null;
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
}

interface RatioRow extends RatioValues {
  id: number;
  teamName?: string;
  berryType?: string;
  srcBreedingProgram?: string;
}

interface Props {
  ratios: RatioRow[];
}

function v(n: number | null | undefined): number {
  return n ?? 0;
}

interface ScenarioInputs {
  shipQty: number;
  discardPercent: number;
  plateQty: number;
  spinyDiscardPercent: number;
}

function calcResults(ratio: RatioValues, inputs: ScenarioInputs) {
  const { shipQty, discardPercent, plateQty, spinyDiscardPercent } = inputs;
  const transplantPct = v(ratio.seedlingTransplantSuccessPercentage);
  const seedGermPct = v(ratio.avgSeedGerminationPercentage);
  const seedGermStdDev = v(ratio.seedGerminationStdDev);
  const seedsPerGram = v(ratio.seedsPerGramOfSeed);
  const seedsPerGramStdDev = v(ratio.seedNumPerGramStdDev);
  const seedPerFruit = v(ratio.gramsSeedPerFruit);
  const seedPerFruitStdDev = v(ratio.gramsSeedPerFruitStdDev);
  const pollinationPct = v(ratio.pollinationSuccessPercentage);
  const pollinationStdDev = v(ratio.pollinationStdDev);
  const femalePerMale = v(ratio.femaleFlowersPerMaleFlower);
  const flowersPerParent = v(ratio.avgFlowersPerParent);
  const flowersPerParentStdDev = v(ratio.flowersPerParentStdDev);
  const bufferPct = v(ratio.bufferPercentOfStdDev);

  let transplantsRequired = 0;
  if (transplantPct > 0 && plateQty > 0) {
    transplantsRequired = Math.ceil(
      ((shipQty / (1 - discardPercent)) / plateQty) / transplantPct
    ) * plateQty;
  }

  let seedWeightRequired = 0;
  const germAdj = seedGermPct - (seedGermStdDev * bufferPct);
  const seedsAdj = seedsPerGram - (seedsPerGramStdDev * bufferPct);
  const spinyAdj = 1 - spinyDiscardPercent;
  if (germAdj > 0 && seedsAdj > 0 && spinyAdj > 0) {
    seedWeightRequired = Math.round(
      ((transplantsRequired / germAdj) / seedsAdj) / spinyAdj * 10000
    ) / 10000;
  }

  let fruitRequired = 0;
  const fruitAdj = seedPerFruit - (seedPerFruitStdDev * bufferPct);
  if (fruitAdj > 0) {
    fruitRequired = Math.ceil(seedWeightRequired / fruitAdj);
  }

  let pollinationsRequired = 0;
  const pollAdj = pollinationPct - (pollinationStdDev * bufferPct);
  if (pollAdj > 0) {
    pollinationsRequired = Math.ceil(fruitRequired / pollAdj);
  }

  let pollenFlowersRequired = 0;
  if (femalePerMale > 0) {
    pollenFlowersRequired = Math.ceil(pollinationsRequired / femalePerMale);
  }

  const parentAdj = flowersPerParent - (flowersPerParentStdDev * bufferPct);
  let p1ParentsRequired = 0;
  let p2ParentsRequired = 0;
  if (parentAdj > 0) {
    p1ParentsRequired = Math.ceil(pollinationsRequired / parentAdj * 1000) / 1000;
    p2ParentsRequired = Math.ceil(pollenFlowersRequired / parentAdj * 1000) / 1000;
  }

  return {
    transplantsRequired,
    seedWeightRequired,
    fruitRequired,
    pollinationsRequired,
    pollenFlowersRequired,
    p1ParentsRequired,
    p2ParentsRequired,
  };
}

const fmt = (n: number) => {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
};

const inputCls = "w-full border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none";

function ScenarioPanel({
  label,
  color,
  inputs,
  onChange,
  results,
  hasRatio,
}: {
  label: string;
  color: string;
  inputs: ScenarioInputs;
  onChange: (inputs: ScenarioInputs) => void;
  results: ReturnType<typeof calcResults> | null;
  hasRatio: boolean;
}) {
  return (
    <div className={cn("flex-1 border rounded-xl p-4 space-y-3", color)}>
      <h4 className="font-semibold text-sm">{label}</h4>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Ship Qty</label>
          <input type="number" min={1} step={1} value={inputs.shipQty}
            onChange={e => onChange({ ...inputs, shipQty: parseInt(e.target.value) || 0 })}
            className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Discard %</label>
          <div className="relative">
            <input type="number" min={0} max={99} step={1}
              value={Math.round((inputs.discardPercent ?? 0) * 100)}
              onChange={e => {
                const raw = parseInt(e.target.value);
                const pct = Number.isFinite(raw) ? Math.min(99, Math.max(0, raw)) : 0;
                onChange({ ...inputs, discardPercent: pct / 100 });
              }}
              className={`${inputCls} pr-7`} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Lab Plate Qty</label>
          <input type="number" min={1} max={100} step={1} value={inputs.plateQty}
            onChange={e => onChange({ ...inputs, plateQty: parseInt(e.target.value) || 1 })}
            className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Spiny Discard %</label>
          <div className="relative">
            <input type="number" min={0} max={99} step={1}
              value={Math.round((inputs.spinyDiscardPercent ?? 0) * 100)}
              onChange={e => {
                const raw = parseInt(e.target.value);
                const pct = Number.isFinite(raw) ? Math.min(99, Math.max(0, raw)) : 0;
                onChange({ ...inputs, spinyDiscardPercent: pct / 100 });
              }}
              className={`${inputCls} pr-7`} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
          </div>
        </div>
      </div>

      {hasRatio && results && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Transplants Req', value: fmt(results.transplantsRequired) },
            { label: 'Seed Weight Req', value: fmt(results.seedWeightRequired) },
            { label: 'Fruit Req', value: fmt(results.fruitRequired) },
            { label: 'Pollinations Req', value: fmt(results.pollinationsRequired) },
            { label: 'Pollen Flowers Req', value: fmt(results.pollenFlowersRequired) },
            { label: 'P1 Parents Req', value: fmt(results.p1ParentsRequired) },
            { label: 'P2 Parents Req', value: fmt(results.p2ParentsRequired) },
          ].map(item => (
            <div key={item.label} className="bg-background/80 border rounded-lg p-2 text-center">
              <p className="text-[11px] text-muted-foreground mb-0.5">{item.label}</p>
              <p className="text-base font-semibold text-foreground">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {!hasRatio && (
        <div className="text-center py-3 text-xs text-muted-foreground">
          Select a ratio row above to see results.
        </div>
      )}
    </div>
  );
}

export function PropCalcsCalculator({ ratios }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedRatioId, setSelectedRatioId] = useState<number | ''>('');
  const [inputsA, setInputsA] = useState<ScenarioInputs>({ shipQty: 100, discardPercent: 0.5, plateQty: 95, spinyDiscardPercent: 0 });
  const [inputsB, setInputsB] = useState<ScenarioInputs>({ shipQty: 200, discardPercent: 0.3, plateQty: 95, spinyDiscardPercent: 0 });

  const selectedRatio = useMemo(
    () => ratios.find(r => r.id === selectedRatioId) ?? null,
    [ratios, selectedRatioId]
  );

  const resultsA = useMemo(() => selectedRatio ? calcResults(selectedRatio, inputsA) : null, [selectedRatio, inputsA]);
  const resultsB = useMemo(() => selectedRatio ? calcResults(selectedRatio, inputsB) : null, [selectedRatio, inputsB]);

  return (
    <div className="mt-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="gap-2"
      >
        <Calculator className="w-4 h-4" />
        Calculation Example
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </Button>

      {open && (
        <div className="mt-3 border rounded-xl p-5 bg-card space-y-5">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Compare two scenarios using the same ratio row
            </p>
            <p className="text-xs text-muted-foreground">
              Select a ratio row, adjust the inputs for each scenario, and compare how the required quantities change.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Ratio Row</label>
            <select
              value={selectedRatioId}
              onChange={e => setSelectedRatioId(e.target.value ? parseInt(e.target.value) : '')}
              className="w-full max-w-md border rounded-lg px-3 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="">Select a ratio row...</option>
              {ratios.map(r => (
                <option key={r.id} value={r.id}>
                  {[r.teamName, r.berryType, r.srcBreedingProgram].filter(Boolean).join(' / ')}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-4 flex-col lg:flex-row">
            <ScenarioPanel
              label="Scenario A"
              color="border-blue-200 bg-blue-50/30"
              inputs={inputsA}
              onChange={setInputsA}
              results={resultsA}
              hasRatio={!!selectedRatio}
            />
            <ScenarioPanel
              label="Scenario B"
              color="border-emerald-200 bg-emerald-50/30"
              inputs={inputsB}
              onChange={setInputsB}
              results={resultsB}
              hasRatio={!!selectedRatio}
            />
          </div>
        </div>
      )}
    </div>
  );
}
