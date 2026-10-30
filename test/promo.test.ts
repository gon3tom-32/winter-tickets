import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/db";
import { checkPromo, type PromoCode } from "@/lib/promo";
import { loadCart } from "@/lib/cart";
import { holdSeat } from "@/lib/holds";
import { abandonCheckout, cancelOrder, fulfillOrder, startCheckout } from "@/lib/orders";
import { quote, type PriceLine } from "@/lib/pricing";
import { performances, pricing, venue } from "@/lib/config";
import { freshDb } from "./helpers";

const base: PromoCode = { id: "p", code: "TEST", kind: "percent", value: 50, seatLimit: 2, seatsUsed: 0, expired: false, active: true, performanceIds: null };
const L = (performanceId: string, priceCents: number): PriceLine => ({ performanceId, seatId: `${performanceId}-${priceCents}-${Math.random()}`, priceCents });

describe("checking a code", () => {
  it("explains why a code can't be used", () => {
    const lines = [L("night-1", 1000)];
    expect(checkPromo(null, lines)).toEqual({ ok: false, reason: "not_found" });
    expect(checkPromo({ ...base, active: false }, lines)).toEqual({ ok: false, reason: "inactive" });
    expect(checkPromo({ ...base, expired: true }, lines)).toEqual({ ok: false, reason: "expired" });
    expect(checkPromo({ ...base, seatsUsed: 2 }, lines)).toEqual({ ok: false, reason: "used_up" });
    expect(checkPromo({ ...base, performanceIds: ["night-2"] }, lines)).toEqual({ ok: false, reason: "not_for_these_nights" });
  });

  it("covers only as many seats as it has left, picking the most expensive", () => {
    const lines = [L("night-1", 800), L("night-1", 1200), L("night-2", 1000)];
    const r = checkPromo({ ...base, seatsUsed: 0 }, lines);
    expect(r.ok && r.option.offByLine).toEqual([0, 600, 500]);
    expect(r.ok && r.option.label).toBe("Code TEST: 50% off 2 seats");
    const one = checkPromo({ ...base, seatsUsed: 1 }, lines);
    expect(one.ok && one.option.offByLine).toEqual([0, 600, 0]);
  });

  it("only covers seats on the nights it's for", () => {
    const lines = [L("night-1", 1200), L("night-2", 800)];
    const r = checkPromo({ ...base, performanceIds: ["night-2"] }, lines);
    expect(r.ok && r.option.offByLine).toEqual([0, 400]);
  });

  it("takes dollars off each covered seat, never below $0", () => {
    const lines = [L("night-1", 1200), L("night-1", 300)];
    const r = checkPromo({ ...base, kind: "amount", value: 500 }, lines);
    expect(r.ok && r.option.offByLine).toEqual([500, 300]);
    expect(r.ok && r.option.label).toBe("Code TEST: $5 off 2 seats");
  });

  it("makes covered seats free with a 100% code", () => {
    const lines = [L("night-1", 1200), L("night-1", 1000)];
    const r = checkPromo({ ...base, value: 100 }, lines);
    expect(quote(lines, { multiNightPercent: 20, minChargeCents: 50, promo: r.ok ? r.option : null }).totalCents).toBe(0);
  });
});

const T = "66666666-6666-4666-8666-666666666666";
const U = "77777777-7777-4777-8777-777777777777";
const [g1, g2] = [performances[0].grades[0], performances[1].grades[0]];
const cartOpts = { multiNightPercent: 20, minChargeCents: 50 };
let pg: PGlite;
let db: Db;
beforeEach(async () => {
  ({ pg, db } = await freshDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
}, 30_000);

const hold = (performanceId: string, seatId: string, token = T) => holdSeat(db, { performanceId, seatId, token, holdMinutes: 10, maxSeats: 10 });
const addCode = (code: string, kind: string, value: number, seats: number, extra = "") =>
  pg.exec(`insert into promo_codes (code, kind, value, seat_limit${extra ? ", performance_ids" : ""}) values ('${code}', '${kind}', ${value}, ${seats}${extra ? `, ${extra}` : ""})`);
const used = async (code: string) => (await pg.query<{ n: number }>(`select seats_used n from promo_codes where code = $1`, [code])).rows[0].n;
const checkout = (promoCode?: string, token = T, grades: Record<string, string[]> = { "night-1": [g1] }) =>
  startCheckout(db, { token, buyerName: "[T]", buyerEmail: "t@example.com", grades, promoCode }, { venue, pricing });

describe("codes in the cart", () => {
  it("matches codes regardless of case and applies the bigger discount", async () => {
    await addCode("Half", "percent", 50, 5);
    await hold("night-1", "C-A-1");
    const cart = await loadCart(db.query, T, venue, { ...cartOpts, promoCode: "  hALF " });
    expect(cart.promo).toMatchObject({ valid: true, applied: true, seatsCovered: 1 });
    expect(cart.quote.totalCents).toBe(600);
  });

  it("keeps the multi-night discount when it's bigger, and doesn't use the code", async () => {
    await addCode("TEN", "percent", 10, 5);
    await hold("night-1", "C-A-1");
    await hold("night-2", "C-A-1");
    const cart = await loadCart(db.query, T, venue, { ...cartOpts, promoCode: "TEN" });
    expect(cart.promo).toMatchObject({ valid: true, applied: false });
    expect(cart.quote.discount?.kind).toBe("multi_night");
    expect(cart.promoInternal).toBeNull();
  });
});

describe("a code's seat balance", () => {
  it("is a running balance across orders", async () => {
    await addCode("TWO", "percent", 100, 2);
    await hold("night-1", "C-A-1");
    const first = await checkout("TWO");
    expect(first).toMatchObject({ ok: true, started: { free: true } });
    expect(await used("TWO")).toBe(1);

    // The next buyer gets the one seat left: their dearer seat is free, the other is full price.
    await hold("night-1", "C-B-1", U);
    await hold("night-1", "L-F-1", U);
    const cart = await loadCart(db.query, U, venue, { ...cartOpts, promoCode: "TWO" });
    expect(cart.promo).toMatchObject({ applied: true, seatsCovered: 1 });
    expect(cart.quote.totalCents).toBe(800);
    expect((await checkout("TWO", U)).ok).toBe(true);
    expect(await used("TWO")).toBe(2);

    await hold("night-1", "C-C-1", "88888888-8888-4888-8888-888888888888");
    expect(await checkout("TWO", "88888888-8888-4888-8888-888888888888")).toEqual({ ok: false, reason: "promo_invalid", problem: "used_up" });
  });

  it("covers seats across nights, and a 100% code skips payment", async () => {
    await addCode("COMP2", "percent", 100, 2);
    await hold("night-1", "C-A-1");
    await hold("night-2", "C-A-1");
    const r = await checkout("COMP2", T, { "night-1": [g1], "night-2": [g2] });
    expect(r).toMatchObject({ ok: true, started: { free: true, totalCents: 0 } });
    expect(await used("COMP2")).toBe(2);
    const sold = (await pg.query(`select count(*)::int n from performance_seats where status = 'sold'`)).rows[0];
    expect(sold).toEqual({ n: 2 });
  });

  it("is given back when the order is cancelled, abandoned, or replaced", async () => {
    await addCode("HALF", "percent", 50, 1);
    await hold("night-1", "C-A-1");

    const a = await checkout("HALF");
    expect(await used("HALF")).toBe(1);
    // Starting checkout again replaces the first order without counting the seat twice.
    const b = await checkout("HALF");
    expect(b.ok).toBe(true);
    expect(await used("HALF")).toBe(1);

    if (!b.ok) throw new Error();
    await abandonCheckout(db, b.started.orderId);
    expect(await used("HALF")).toBe(0);

    const c = await checkout("HALF");
    if (!c.ok) throw new Error();
    await cancelOrder(db, c.started.orderId);
    await cancelOrder(db, c.started.orderId);
    expect(await used("HALF")).toBe(0);
    expect(a.ok).toBe(true);
  });

  it("is given back when payment arrives too late and is refunded", async () => {
    await addCode("HALF", "percent", 50, 1);
    await hold("night-1", "C-A-1");
    const r = await checkout("HALF");
    if (!r.ok) throw new Error();
    await pg.exec(`update performance_seats set hold_expires_at = now() - interval '1 minute'`);
    await hold("night-1", "C-A-1", U);
    expect(await fulfillOrder(db, r.started.orderId, "pi")).toBe("conflict");
    expect(await used("HALF")).toBe(0);
  });

  it("is taken again if a cancelled order gets paid after all, or refunded if none are left", async () => {
    await addCode("HALF", "percent", 50, 1);
    await hold("night-1", "C-A-1");
    const r = await checkout("HALF");
    if (!r.ok) throw new Error();
    await cancelOrder(db, r.started.orderId);
    // Payment from the old page still arrives. Seats are open again, so it can go through.
    await pg.exec(`update performance_seats set status = 'held', hold_token = '${T}', hold_expires_at = now() + interval '5 minutes', order_id = '${r.started.orderId}' where seat_id = 'C-A-1' and performance_id = 'night-1'`);
    expect(await fulfillOrder(db, r.started.orderId, "pi")).toBe("paid");
    expect(await used("HALF")).toBe(1);

    // Same again, but someone else used the code's last seat meanwhile.
    await hold("night-2", "C-A-1", U);
    const s = await checkout("HALF", U, { "night-2": [g2] });
    expect(s).toEqual({ ok: false, reason: "promo_invalid", problem: "used_up" });
  });

  it("rolls everything back if the code is no good at checkout", async () => {
    await addCode("OLD", "percent", 50, 5);
    await hold("night-1", "C-A-1");
    const first = await checkout();
    await pg.exec(`update promo_codes set active = false`);
    expect(await checkout("OLD")).toEqual({ ok: false, reason: "promo_invalid", problem: "inactive" });
    // The earlier checkout was left alone.
    if (!first.ok) throw new Error();
    const [o] = (await pg.query<{ status: string }>(`select status from orders where id = $1`, [first.started.orderId])).rows;
    expect(o.status).toBe("pending");
  });

  it("only counts toward codes limited to certain nights for those nights", async () => {
    await addCode("N2", "amount", 500, 3, "array['night-2']");
    await hold("night-1", "C-A-1");
    await hold("night-2", "C-A-2");
    const cart = await loadCart(db.query, T, venue, { ...cartOpts, promoCode: "N2" });
    // $5 off one seat beats 20% off both seats ($4.80), so the code wins.
    expect(cart.promo).toMatchObject({ applied: true, seatsCovered: 1 });
    expect(cart.quote.totalCents).toBe(1900);
  });
});
