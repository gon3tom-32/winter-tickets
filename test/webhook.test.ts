import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/db";
import { holdSeat } from "@/lib/holds";
import { startCheckout } from "@/lib/orders";
import { performances, pricing, venue } from "@/lib/config";
import { freshDb } from "./helpers";

const SECRET = "whsec_test_secret";
let pg: PGlite;
let db: Db;

vi.mock("@/lib/server-source", () => ({ getDb: () => db, getSource: () => null }));

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_not_used_for_network";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});
beforeEach(async () => {
  ({ pg, db } = await freshDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
}, 30_000);

const stripe = new Stripe("sk_test_dummy");
function signed(event: object) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } });
}
const sessionEvent = (id: string, type: string, orderId: string, paid = true) => ({
  id,
  type,
  object: "event",
  data: { object: { object: "checkout.session", id: "cs_1", metadata: { order_id: orderId }, client_reference_id: orderId, payment_status: paid ? "paid" : "unpaid", payment_intent: "pi_1" } },
});

async function pendingOrder() {
  const token = crypto.randomUUID();
  await holdSeat(db, { performanceId: "night-1", seatId: "C-A-1", token, holdMinutes: 10, maxSeats: 10 });
  const r = await startCheckout(db, { token, buyerName: "[T]", buyerEmail: "t@example.com", grades: { "night-1": [performances[0].grades[0]] } }, { venue, pricing });
  if (!r.ok) throw new Error(r.reason);
  return r.started.orderId;
}
const status = async (orderId: string) => (await pg.query<{ status: string }>(`select status from orders where id = $1`, [orderId])).rows[0].status;

describe("Stripe webhook", () => {
  it("rejects a request without a valid signature", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=bad" } }));
    expect(res.status).toBe(400);
  });

  it("sells the seats when payment completes, and ignores the same event sent twice", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const orderId = await pendingOrder();
    const ev = sessionEvent("evt_1", "checkout.session.completed", orderId);
    expect((await POST(signed(ev))).status).toBe(200);
    expect(await status(orderId)).toBe("paid");
    const again = await (await POST(signed(ev))).json();
    expect(again.duplicate).toBe(true);
  });

  it("doesn't sell seats for a completed but unpaid session", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const orderId = await pendingOrder();
    await POST(signed(sessionEvent("evt_2", "checkout.session.completed", orderId, false)));
    expect(await status(orderId)).toBe("pending");
  });

  it("cancels the order and frees the seats when the payment page expires", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const orderId = await pendingOrder();
    await POST(signed(sessionEvent("evt_3", "checkout.session.expired", orderId, false)));
    expect(await status(orderId)).toBe("cancelled");
    const [s] = (await pg.query<{ status: string }>(`select status from performance_seats where performance_id = 'night-1' and seat_id = 'C-A-1'`)).rows;
    expect(s.status).toBe("available");
  });
});
