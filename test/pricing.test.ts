import { describe, expect, it } from "vitest";
import { allocate, quote, type DiscountOption, type PriceLine } from "@/lib/pricing";

const opts = { multiNightPercent: 20, minChargeCents: 50 };
const line = (performanceId: string, priceCents: number, seatId = Math.random().toString()): PriceLine => ({ performanceId, seatId, priceCents });
const promo = (lines: PriceLine[], percent: number): DiscountOption => ({
  kind: "promo",
  label: `Code: ${percent}% off`,
  offByLine: lines.map((l) => (l.priceCents * percent) / 100),
});

describe("multi-night discount", () => {
  it("doesn't apply to one night", () => {
    const q = quote([line("n1", 1200), line("n1", 1000)], opts);
    expect(q).toMatchObject({ subtotalCents: 2200, totalCents: 2200, discount: null, nights: 1 });
  });

  it("takes 20% off every seat for 2 nights, matching the spec's price table", () => {
    const q = quote([line("n1", 1200), line("n2", 1000), line("n2", 800)], opts);
    expect(q.paidCents).toEqual([960, 800, 640]);
    expect(q.totalCents).toBe(2400);
    expect(q.discount).toEqual({ kind: "multi_night", label: "20% off for 2 nights", amountCents: 600 });
  });

  it("gives no extra discount for a third night", () => {
    const q = quote([line("n1", 1000), line("n2", 1000), line("n3", 1000)], opts);
    expect(q.totalCents).toBe(2400);
  });

  it("discounts a mixed cart from each seat's own price", () => {
    const q = quote([line("n1", 1200), line("n2", 800)], opts);
    expect(q.paidCents).toEqual([960, 640]);
  });
});

describe("better discount wins, never both", () => {
  it("uses the promo code when it's bigger", () => {
    const lines = [line("n1", 1000), line("n2", 1000)];
    const q = quote(lines, { ...opts, promo: promo(lines, 50) });
    expect(q.totalCents).toBe(1000);
    expect(q.discount?.kind).toBe("promo");
  });

  it("uses the multi-night discount when it's bigger", () => {
    const lines = [line("n1", 1000), line("n2", 1000)];
    const q = quote(lines, { ...opts, promo: promo(lines, 10) });
    expect(q.totalCents).toBe(1600);
    expect(q.discount?.kind).toBe("multi_night");
  });

  it("keeps the multi-night discount on a tie", () => {
    const lines = [line("n1", 1000), line("n2", 1000)];
    expect(quote(lines, { ...opts, promo: promo(lines, 20) }).discount?.kind).toBe("multi_night");
  });

  it("never takes a seat below $0, and a 100% code makes the order free", () => {
    const lines = [line("n1", 1000)];
    const big: DiscountOption = { kind: "promo", label: "x", offByLine: [5000] };
    expect(quote(lines, { ...opts, promo: big })).toMatchObject({ totalCents: 0, paidCents: [0], problem: null });
  });
});

describe("rounding", () => {
  it("rounds once at the end, not per seat", () => {
    // 3 seats at $3.33, 20% off: each is 266.4 cents exactly. Per-seat rounding would give 798; once gives 799.
    const q = quote([line("n1", 333), line("n2", 333), line("n2", 333)], opts);
    expect(q.totalCents).toBe(799);
    expect(q.paidCents.reduce((a, b) => a + b, 0)).toBe(799);
  });

  it("splits the total so per-seat prices always add up to it", () => {
    expect(allocate([266.4, 266.4, 266.4], 799)).toEqual([267, 266, 266]);
    expect(allocate([100, 200], 300)).toEqual([100, 200]);
    expect(allocate([0.5, 0.5], 1)).toEqual([1, 0]);
    for (let t = 0; t < 200; t++) {
      const exact = Array.from({ length: 1 + (t % 7) }, () => Math.random() * 1500);
      const total = Math.round(exact.reduce((a, b) => a + b, 0));
      expect(allocate(exact, total).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe("minimum charge", () => {
  it("blocks a total between 1 and 49 cents", () => {
    const lines = [line("n1", 100)];
    const q = quote(lines, { ...opts, promo: { kind: "promo", label: "x", offByLine: [70] } });
    expect(q).toMatchObject({ totalCents: 30, problem: "below_minimum" });
  });

  it("allows exactly 50 cents, and $0", () => {
    expect(quote([line("n1", 50)], opts).problem).toBeNull();
    expect(quote([], opts)).toMatchObject({ totalCents: 0, problem: null, discount: null });
  });
});
