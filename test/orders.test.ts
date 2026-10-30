import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/db";
import { holdSeat } from "@/lib/holds";
import { cancelOrder, fulfillOrder, getOrder, startCheckout, type CheckoutStarted } from "@/lib/orders";
import { onPaymentConfirmed } from "@/lib/confirmation";
import type { Payments } from "@/lib/payments";
import { performances, pricing, venue } from "@/lib/config";
import { freshDb } from "./helpers";

const T = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const [g1, g2] = [performances[0].grades[0], performances[1].grades[0]];
const buyer = { buyerName: "[Test Parent]", buyerEmail: "Parent@Example.com " };

let pg: PGlite;
let db: Db;
beforeEach(async () => {
  ({ pg, db } = await freshDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
}, 30_000);

const hold = (performanceId: string, seatId: string, token = T) =>
  holdSeat(db, { performanceId, seatId, token, holdMinutes: 10, maxSeats: 10 });
const checkout = (grades: Record<string, string[]> = { "night-1": [g1] }, b = buyer, token = T) =>
  startCheckout(db, { token, ...b, grades }, { venue, pricing });
const started = async (...args: Parameters<typeof checkout>) => {
  const r = await checkout(...args);
  if (!r.ok) throw new Error(`checkout failed: ${r.reason}`);
  return r.started;
};
const seat = async (performanceId: string, seatId: string) =>
  (await pg.query<Record<string, unknown>>(`select * from performance_seats where performance_id = $1 and seat_id = $2`, [performanceId, seatId])).rows[0];
const order = async (id: string) => (await pg.query<Record<string, unknown>>(`select * from orders where id = $1`, [id])).rows[0];

function fakePayments(opts: { failRefunds?: number } = {}) {
  let failures = opts.failRefunds ?? 0;
  const refunds: string[] = [];
  const p: Payments = {
    kind: "fake",
    createSession: async () => ({ id: "s", url: "u" }),
    expireSession: async () => {},
    refund: async (pi) => {
      if (failures-- > 0) throw new Error("Stripe is down");
      refunds.push(pi);
    },
  };
  return { p, refunds };
}

describe("starting checkout", () => {
  it("checks the buyer's name, email, cart, and grades", async () => {
    expect(await checkout(undefined, { buyerName: "  ", buyerEmail: "a@b.co" })).toMatchObject({ ok: false, reason: "invalid_name" });
    expect(await checkout(undefined, { buyerName: "A", buyerEmail: "not an email" })).toMatchObject({ ok: false, reason: "invalid_email" });
    expect(await checkout()).toMatchObject({ ok: false, reason: "empty_cart" });
    await hold("night-1", "C-A-1");
    await hold("night-2", "C-A-1");
    expect(await checkout({ "night-1": [g1] })).toEqual({ ok: false, reason: "missing_grades", nights: ["night-2"] });
  });

  it("creates a pending order priced on the server and keeps the seats held for 30 minutes", async () => {
    await hold("night-1", "C-A-1");
    await hold("night-2", "L-F-1");
    const s = await started({ "night-1": [g1], "night-2": [g2, performances[1].grades[1]] });
    expect(s).toMatchObject({ totalCents: 1600, free: false, staleSessions: [] });
    expect(s.lines.map((l) => l.amountCents)).toEqual([960, 640]);
    expect(s.lines[0].name).toContain("Center Front, Row A, Seat 1");

    const o = await order(s.orderId);
    expect(o).toMatchObject({ status: "pending", buyer_email: "parent@example.com", total_cents: 1600, hold_token: T });
    const items = (await pg.query(`select seat_id, price_cents, grades_supported from order_items where order_id = $1 order by seat_id`, [s.orderId])).rows;
    expect(items).toEqual([
      { seat_id: "C-A-1", price_cents: 960, grades_supported: [g1] },
      { seat_id: "L-F-1", price_cents: 640, grades_supported: [g2, performances[1].grades[1]] },
    ]);
    const st = await seat("night-1", "C-A-1");
    expect(st).toMatchObject({ status: "held", order_id: s.orderId });
    expect(new Date(st.hold_expires_at as string).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
  });

  it("confirms a $0 order right away without payment", async () => {
    await pg.exec(`update tiers set price_cents = 0`);
    await hold("night-1", "C-A-1");
    const s = await started();
    expect(s.free).toBe(true);
    expect((await order(s.orderId)).status).toBe("free");
    expect(await seat("night-1", "C-A-1")).toMatchObject({ status: "sold", order_id: s.orderId, hold_token: null });
  });

  it("replaces an earlier unfinished checkout and hands back its payment page to close", async () => {
    await hold("night-1", "C-A-1");
    const first = await started();
    await pg.query(`update orders set stripe_session_id = 'cs_old' where id = $1`, [first.orderId]);
    const second = await started();
    expect(second.staleSessions).toEqual(["cs_old"]);
    expect((await order(first.orderId)).status).toBe("cancelled");
    expect((await seat("night-1", "C-A-1")).order_id).toBe(second.orderId);
  });

  it("refuses if the seats changed since the cart was loaded", async () => {
    await hold("night-1", "C-A-1");
    await pg.exec(`update performance_seats set hold_expires_at = now() - interval '1 second'`);
    expect(await checkout()).toMatchObject({ ok: false, reason: "empty_cart" });
  });
});

describe("payment confirmed", () => {
  let s: CheckoutStarted;
  beforeEach(async () => {
    await hold("night-1", "C-A-1");
    await hold("night-1", "C-A-2");
    s = await started();
  });

  it("marks the seats sold only now, and only once", async () => {
    expect((await seat("night-1", "C-A-1")).status).toBe("held");
    expect(await fulfillOrder(db, s.orderId, "pi_1")).toBe("paid");
    expect(await seat("night-1", "C-A-1")).toMatchObject({ status: "sold", order_id: s.orderId, hold_token: null });
    expect(await order(s.orderId)).toMatchObject({ status: "paid", stripe_payment_intent: "pi_1" });
    expect(await fulfillOrder(db, s.orderId, "pi_1")).toBe("already_done");
  });

  it("still works if the hold ran out but nobody else took the seats", async () => {
    await pg.exec(`update performance_seats set hold_expires_at = now() - interval '1 minute'`);
    expect(await fulfillOrder(db, s.orderId, "pi_1")).toBe("paid");
  });

  it("refunds, flags for staff, and sells nothing if even one seat is gone", async () => {
    await pg.exec(`update performance_seats set hold_expires_at = now() - interval '1 minute'`);
    await hold("night-1", "C-A-2", OTHER);
    const { p, refunds } = fakePayments();
    expect(await onPaymentConfirmed(db, p, s.orderId, "pi_2")).toBe("conflict");
    expect(refunds).toEqual(["pi_2"]);
    expect(await order(s.orderId)).toMatchObject({ status: "refunded", needs_attention: true });
    expect((await seat("night-1", "C-A-1")).status).not.toBe("sold");
    expect(await seat("night-1", "C-A-2")).toMatchObject({ status: "held", hold_token: OTHER });

    // Stripe sends the event again: no second refund.
    await onPaymentConfirmed(db, p, s.orderId, "pi_2");
    expect(refunds).toEqual(["pi_2"]);
  });

  it("retries a refund that failed the first time", async () => {
    await pg.exec(`update performance_seats set hold_expires_at = now() - interval '1 minute'`);
    await hold("night-1", "C-A-1", OTHER);
    const { p, refunds } = fakePayments({ failRefunds: 1 });
    await expect(onPaymentConfirmed(db, p, s.orderId, "pi_3")).rejects.toThrow(/Stripe is down/);
    await onPaymentConfirmed(db, p, s.orderId, "pi_3");
    expect(refunds).toEqual(["pi_3"]);
    expect((await order(s.orderId)).refund_issued_at).not.toBeNull();
  });

  it("sends the confirmation email once, even if confirmed twice", async () => {
    const log = vi.mocked(console.log);
    const { p } = fakePayments();
    await onPaymentConfirmed(db, p, s.orderId, "pi_4");
    await onPaymentConfirmed(db, p, s.orderId, "pi_4");
    const sent = log.mock.calls.filter((c) => String(c[0]).includes("Your Winter Performance tickets"));
    expect(sent).toHaveLength(1);
    expect(String(sent[0][0])).toContain("to=parent@example.com");
    expect((await order(s.orderId)).confirmation_sent_at).not.toBeNull();
  });
});

describe("expired or abandoned payment page", () => {
  it("cancels the order and frees its seats", async () => {
    await hold("night-1", "C-A-1");
    const s = await started();
    expect(await cancelOrder(db, s.orderId)).toBe(true);
    expect((await order(s.orderId)).status).toBe("cancelled");
    expect(await seat("night-1", "C-A-1")).toMatchObject({ status: "available", order_id: null, hold_token: null });
  });

  it("leaves seats alone if they've moved to a newer checkout", async () => {
    await hold("night-1", "C-A-1");
    const first = await started();
    const second = await started();
    await cancelOrder(db, first.orderId);
    expect(await seat("night-1", "C-A-1")).toMatchObject({ status: "held", order_id: second.orderId });
  });
});

describe("order page access", () => {
  it("needs the right key", async () => {
    await hold("night-1", "C-A-1");
    const s = await started();
    expect(await getOrder(db, s.orderId, "wrong", venue)).toBeNull();
    const view = await getOrder(db, s.orderId, s.accessKey, venue);
    expect(view).toMatchObject({ status: "pending", totalCents: 1200 });
    expect(view!.nights[0]).toMatchObject({ grades: [g1], seats: [{ label: "Center Front, Row A, Seat 1", paidCents: 1200 }] });
  });
});
