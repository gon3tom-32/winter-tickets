// The price calculation. Only the server's result counts; the browser just shows it.
//
// Order (from the spec):
// 1. Price each seat at its tier price, in cents.
// 2. If the order covers 2 or more nights, the multi-night discount takes
//    a percentage off every seat. A third night adds nothing more.
// 3. If a promo code applies, work out its discount on the same seats.
// 4. Use whichever discount is better for the buyer. They never combine.
// 5. Round once, at the end.
// 6. A total of $0 skips payment. A total above $0 but below the card
//    processor's minimum can't be charged, so checkout is blocked.

export type PriceLine = { performanceId: string; seatId: string; priceCents: number };

/** A discount option, as an exact (unrounded) amount off each line, keyed by line index. */
export type DiscountOption = { kind: "multi_night" | "promo"; label: string; offByLine: number[] };

export type Quote = {
  subtotalCents: number;
  nights: number;
  discount: { kind: DiscountOption["kind"]; label: string; amountCents: number } | null;
  totalCents: number;
  /** What each seat costs after the discount, in cents. Always adds up to totalCents. */
  paidCents: number[];
  problem: "below_minimum" | null;
};

export type QuoteOptions = {
  multiNightPercent: number;
  /** Smallest card charge allowed, in cents. Stripe's is 50. */
  minChargeCents: number;
  /** A promo code's discount, worked out by the caller (step 6). */
  promo?: DiscountOption | null;
};

export function multiNightOption(lines: PriceLine[], percent: number): DiscountOption | null {
  const nights = new Set(lines.map((l) => l.performanceId)).size;
  if (nights < 2 || percent <= 0) return null;
  return {
    kind: "multi_night",
    label: `${percent}% off for ${nights} nights`,
    offByLine: lines.map((l) => (l.priceCents * percent) / 100),
  };
}

export function quote(lines: PriceLine[], opts: QuoteOptions): Quote {
  const subtotalCents = lines.reduce((sum, l) => sum + l.priceCents, 0);
  const nights = new Set(lines.map((l) => l.performanceId)).size;

  const options = [multiNightOption(lines, opts.multiNightPercent), opts.promo ?? null].filter(
    (o): o is DiscountOption => o !== null,
  );
  // A line can never go below $0.
  const exactOff = (o: DiscountOption) => o.offByLine.reduce((sum, off, i) => sum + Math.min(off, lines[i].priceCents), 0);
  // Better for the buyer wins. On a tie, the multi-night discount is listed first and is kept.
  const best = options.reduce<DiscountOption | null>((a, o) => (a === null || exactOff(o) > exactOff(a) ? o : a), null);

  const exactPaid = lines.map((l, i) => l.priceCents - (best ? Math.min(best.offByLine[i], l.priceCents) : 0));
  const totalCents = Math.round(exactPaid.reduce((a, b) => a + b, 0));
  const paidCents = allocate(exactPaid, totalCents);
  const amountCents = subtotalCents - totalCents;

  return {
    subtotalCents,
    nights,
    discount: best && amountCents > 0 ? { kind: best.kind, label: best.label, amountCents } : null,
    totalCents,
    paidCents,
    problem: totalCents > 0 && totalCents < opts.minChargeCents ? "below_minimum" : null,
  };
}

/**
 * Splits a whole-cent total across lines in proportion to their exact amounts,
 * so the per-seat prices stored on the order always add up to what was charged.
 * Leftover cents go to the lines with the largest fractions.
 */
export function allocate(exact: number[], totalCents: number): number[] {
  const floors = exact.map((x) => Math.floor(x + 1e-9));
  let left = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - floors[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  // totalCents is the rounded sum, so it's never below the sum of the floors.
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}
