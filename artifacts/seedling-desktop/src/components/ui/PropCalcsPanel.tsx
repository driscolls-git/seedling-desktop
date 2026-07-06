import React, { useState } from 'react';
import { Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '\./button';
import { cn } from '@/lib/utils';

const READABLE_CALCS = [
  {
    step: '1',
    factor: 'Seedling Ship #',
    description: 'Add the shipment quantities for Destination 1 and Destination 2 to get the total number of seedlings to ship.',
  },
  {
    step: '2',
    factor: 'Transplants Required',
    description: 'If the Marker Screen Discard % is zero, then you simply use the Seedling Ship #. If there is any discard rate, you calculate the number of seedlings needed to compensate for loss by dividing the shipment requirement by (1 \u2013 discard rate), adjusting for plate size, and adjusting for the transplant success rate. Then round up to the nearest full plate.',
  },
  {
    step: '3',
    factor: 'Seed Weight Required',
    description: 'Calculate how many seeds are needed by adjusting for seed germination rate, germination variability (standard deviation \u00d7 buffer), and seeds per gram (also adjusted for variability). Then divide by the adjusted seeds-per-gram value to convert the seed count into grams, and round to four decimals. If the berry type is Black, also adjust for the Spineless discard %, otherwise no adjustment.',
  },
  {
    step: '4',
    factor: 'Fruit Required',
    description: 'Divide the required seed weight by the expected grams of seed per fruit (adjusted for variability), and round up to get the total number of fruits needed.',
  },
  {
    step: '5',
    factor: 'Pollinations Required',
    description: 'Divide the required number of fruits by the expected pollination success rate (adjusted for variability), then round up to determine how many successful pollinations are needed.',
  },
  {
    step: '6',
    factor: 'Pollen Flowers Required',
    description: 'Divide the number of pollinations required by the number of female flowers produced per male flower, then round up to get the total pollen\u2011producing flowers needed.',
  },
  {
    step: '7',
    factor: 'P2 Parents Required',
    description: 'Divide the required number of pollen flowers by the expected number of flowers per parent plant (adjusted for variability), and round up to three decimal places to determine how many P2 parent plants are needed.',
  },
  {
    step: '8',
    factor: 'P1 Parents Required',
    description: 'Divide the required number of pollinations by the expected number of flowers per parent plant (adjusted for variability), and round up to three decimal places to get the number of P1 parent plants needed.',
  },
];

const FORMULA_CALCS = [
  { factor: 'Seedling Ship #', calculation: 'Destination 1 Ship # + Destination 2 Ship #' },
  { factor: 'Transplants Required', calculation: 'If Marker Screen Discard % = 0, then use Seedling Ship #, Else RoundUp(((Seedlings Ship # / (1 \u2013 Discard %)) / (Plate #)) / (Seedling Transplant Success %) , 0) \u00d7 (Plate #)' },
  { factor: 'Seed Weight Required', calculation: 'Round(((Transplants Req. / (Avg Seed Germination % - (Seed Germination Std Dev \u00d7 Buffer % of Std Dev))) / (Seeds Per Gram of Seed \u2013 (Seed num Per Gram Std Dev \u00d7 Buffer % of Std Dev))) / (If (Berry=Black,(1-Spineless Discard %),1)) , 4)' },
  { factor: 'Fruit Required', calculation: 'RoundUp(Seed Weight Required / (Grams Seed Per Fruit \u2013 (Grams Seed Per Fruit Std Dev \u00d7 Buffer % of Std Dev)) , 0)' },
  { factor: 'Pollinations Required', calculation: 'RoundUp(Fruit Required / (Pollination Success % - (Pollination Std Dev \u00d7 Buffer % of Std Dev)),0)' },
  { factor: 'Pollen Flowers Required', calculation: 'RoundUp(Pollinations Required / (Female Flowers Per Male Flower) , 0)' },
  { factor: 'P2 Parents Required', calculation: 'RoundUp(Pollen Flowers Required / (Avg Flowers Per Parent \u2013 (Flowers Per Parent Std Dev \u00d7 Buffer % of Std Dev)),3)' },
  { factor: 'P1 Parents Required', calculation: 'RoundUp(Pollinations Required / (Avg Flowers Per Parent \u2013 (Flowers Per Parent Std Dev \u00d7 Buffer % of Std Dev)),3)' },
];

export function PropCalcsPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="gap-2"
      >
        <Calculator className="w-4 h-4" />
        Propagation Calculations
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </Button>

      {open && (
        <div className="mt-3 space-y-4">
          <div className="border rounded-xl overflow-hidden">
            <div className="bg-primary/5 px-4 py-2.5 border-b">
              <h4 className="font-semibold text-sm text-foreground">How the Calculations Work</h4>
            </div>
            <div className="divide-y">
              {READABLE_CALCS.map((row) => (
                <div key={row.step} className={cn("px-4 py-3 flex gap-3")}>
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                    {row.step}
                  </span>
                  <div>
                    <div className="font-semibold text-sm">{row.factor}</div>
                    <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{row.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border rounded-xl overflow-hidden">
            <div className="bg-muted/50 px-4 py-2.5 border-b">
              <h4 className="font-semibold text-sm text-muted-foreground">Detailed Formulas</h4>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b">
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground w-[200px]">Factor</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Calculation</th>
                </tr>
              </thead>
              <tbody>
                {FORMULA_CALCS.map((row, i) => (
                  <tr key={row.factor} className={cn("border-b last:border-b-0", i % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                    <td className="px-4 py-2.5 font-medium">{row.factor}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.calculation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
