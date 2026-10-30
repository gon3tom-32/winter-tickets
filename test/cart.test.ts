import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { gradeProblems, loadCart } from "@/lib/cart";
import { holdSeat } from "@/lib/holds";
import { venue } from "@/lib/config";
import { freshDb } from "./helpers";

const T = "33333333-3333-4333-8333-333333333333";
const opts = { multiNightPercent: 20, minChargeCents: 50 };
let db: Db;
beforeEach(async () => {
  ({ db } = await freshDb());
}, 30_000);

const hold = (performanceId: string, seatId: string) => holdSeat(db, { performanceId, seatId, token: T, holdMinutes: 10, maxSeats: 10 });

describe("cart", () => {
  it("is empty for a buyer with no holds", async () => {
    const cart = await loadCart(db, T, venue, opts);
    expect(cart).toMatchObject({ nights: [], expiresAt: null });
    expect(cart.quote.totalCents).toBe(0);
  });

  it("groups held seats by night with labels and database prices", async () => {
    await hold("night-1", "C-A-1");
    await hold("night-1", "L-F-2");
    const cart = await loadCart(db, T, venue, opts);
    expect(cart.nights).toHaveLength(1);
    expect(cart.nights[0].seats.map((s) => [s.label, s.tierName, s.priceCents])).toEqual([
      ["Center Front, Row A, Seat 1", "Premium", 1200],
      ["Left Back, Row F, Seat 2", "Value", 800],
    ]);
    expect(cart.quote).toMatchObject({ subtotalCents: 2000, totalCents: 2000, discount: null });
    expect(cart.expiresAt).not.toBeNull();
  });

  it("applies 20% off once seats on a second night are added", async () => {
    await hold("night-1", "C-A-1");
    await hold("night-2", "C-A-1");
    const cart = await loadCart(db, T, venue, opts);
    expect(cart.nights.map((n) => n.performance.id)).toEqual(["night-1", "night-2"]);
    expect(cart.quote.totalCents).toBe(1920);
    expect(cart.nights.flatMap((n) => n.seats.map((s) => s.paidCents))).toEqual([960, 960]);
  });

  it("uses the price in the database, so a price change shows up right away", async () => {
    await hold("night-1", "C-A-1");
    await db.query(`update tiers set price_cents = 1500 where id = 'premium'`);
    expect((await loadCart(db, T, venue, opts)).quote.totalCents).toBe(1500);
  });

  it("leaves out expired holds", async () => {
    await hold("night-1", "C-A-1");
    await db.query(`update performance_seats set hold_expires_at = now() - interval '1 second'`);
    expect((await loadCart(db, T, venue, opts)).nights).toEqual([]);
  });
});

describe("grade choices", () => {
  it("needs at least one grade for every night, from that night's grades", async () => {
    await hold("night-1", "C-A-1");
    await hold("night-2", "C-A-1");
    const { nights } = await loadCart(db, T, venue, opts);
    const [g1, g2] = [nights[0].performance.grades, nights[1].performance.grades];
    expect(gradeProblems(nights, {})).toEqual(["night-1", "night-2"]);
    expect(gradeProblems(nights, { "night-1": [g1[0]] })).toEqual(["night-2"]);
    expect(gradeProblems(nights, { "night-1": [g1[0]], "night-2": [g2[0], g2[1]] })).toEqual([]);
    // A grade from a different night doesn't count.
    expect(gradeProblems(nights, { "night-1": [g1[0]], "night-2": [g1[0]] })).toEqual(["night-2"]);
  });
});
