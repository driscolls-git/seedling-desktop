export type Priority = "D1" | "D2" | "EQUAL";

export interface AllocationInput {
  sortGroupTotals: number[]; // length 5
  d1ShipRequest: number;
  d2ShipRequest: number;
  priorities: Priority[]; // length 5
}

export interface AllocationResult {
  d1: number[]; // per-sort-group amount to D1 (length 5)
  d2: number[]; // per-sort-group amount to D2 (length 5)
  d1Total: number;
  d2Total: number;
}

/**
 * Distribute the per-sort-group totals between D1 and D2 destinations.
 * Sort groups are processed in order 1 -> 5, tracking remaining capacity per side.
 * - D1: fills D1 up to remaining D1 capacity, overflow goes to D2 (no cap on D2 overflow).
 * - D2: mirror of D1.
 * - EQUAL: split 50/50, capped by each side's remaining capacity. If one side is capped,
 *   the surplus spills to the other side.
 */
export function allocateSortGroups(input: AllocationInput): AllocationResult {
  const totals = input.sortGroupTotals.slice(0, 5);
  const priorities = input.priorities.slice(0, 5);
  const d1: number[] = [0, 0, 0, 0, 0];
  const d2: number[] = [0, 0, 0, 0, 0];

  let d1Remaining = Math.max(0, input.d1ShipRequest);
  let d2Remaining = Math.max(0, input.d2ShipRequest);

  for (let i = 0; i < 5; i++) {
    const total = Math.max(0, totals[i] ?? 0);
    if (total === 0) continue;
    const pri = priorities[i] ?? "EQUAL";

    if (pri === "D1") {
      const toD1 = Math.min(total, d1Remaining);
      d1[i] = toD1;
      d2[i] = total - toD1;
    } else if (pri === "D2") {
      const toD2 = Math.min(total, d2Remaining);
      d2[i] = toD2;
      d1[i] = total - toD2;
    } else {
      // EQUAL: split half and half, then re-spill any cap overflow
      const half = Math.floor(total / 2);
      const remainder = total - half * 2; // 0 or 1 (due to odd totals)
      let toD1 = half;
      let toD2 = half + remainder; // give the odd unit to D2 first

      // Cap D1 by remaining capacity, spill to D2
      if (toD1 > d1Remaining) {
        const spill = toD1 - d1Remaining;
        toD1 = d1Remaining;
        toD2 += spill;
      }
      // Cap D2 by remaining capacity, spill to D1 (D1 may be over its cap as a result)
      if (toD2 > d2Remaining) {
        const spill = toD2 - d2Remaining;
        toD2 = d2Remaining;
        toD1 += spill;
      }
      d1[i] = toD1;
      d2[i] = toD2;
    }

    d1Remaining = Math.max(0, d1Remaining - d1[i]);
    d2Remaining = Math.max(0, d2Remaining - d2[i]);
  }

  const d1Total = d1.reduce((a, b) => a + b, 0);
  const d2Total = d2.reduce((a, b) => a + b, 0);

  return { d1, d2, d1Total, d2Total };
}

/** Infer initial priorities from existing splits (best-guess: D1 if d1 has all/most, etc.) */
export function inferPriorities(
  totals: number[],
  d1Splits: number[],
  d2Splits: number[]
): Priority[] {
  return totals.map((total, i) => {
    if (total === 0) return "EQUAL";
    const d1v = d1Splits[i] ?? 0;
    const d2v = d2Splits[i] ?? 0;
    if (d2v === 0 && d1v > 0) return "D1";
    if (d1v === 0 && d2v > 0) return "D2";
    return "EQUAL";
  });
}
