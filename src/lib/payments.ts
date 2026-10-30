// Card payments. Stripe when STRIPE_SECRET_KEY is set. Without it, FAKE_PAYMENTS=1
// turns on a stand-in payment page for testing; otherwise paid checkout is off.
import Stripe from "stripe";
import { siteUrl } from "./site";

export type CheckoutLine = { name: string; amountCents: number };

export interface Payments {
  kind: "stripe" | "fake";
  createSession(o: {
    orderId: string;
    accessKey: string;
    email: string;
    lines: CheckoutLine[];
    expiresAt: Date;
  }): Promise<{ id: string; url: string }>;
  expireSession(id: string): Promise<void>;
  refund(paymentIntentId: string): Promise<void>;
}

let stripe: Stripe | undefined;
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return (stripe ??= new Stripe(key));
}

export const orderUrl = (orderId: string, accessKey: string) => siteUrl(`order/${orderId}?k=${accessKey}`);

function stripePayments(s: Stripe): Payments {
  return {
    kind: "stripe",
    async createSession({ orderId, accessKey, email, lines, expiresAt }) {
      const session = await s.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        client_reference_id: orderId,
        metadata: { order_id: orderId },
        payment_intent_data: { metadata: { order_id: orderId } },
        line_items: lines.map((l) => ({
          quantity: 1,
          price_data: { currency: "usd", unit_amount: l.amountCents, product_data: { name: l.name } },
        })),
        success_url: orderUrl(orderId, accessKey),
        cancel_url: siteUrl("cart?payment=cancelled"),
        expires_at: Math.floor(expiresAt.getTime() / 1000),
      });
      return { id: session.id, url: session.url! };
    },
    async expireSession(id) {
      await s.checkout.sessions.expire(id);
    },
    async refund(paymentIntentId) {
      await s.refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey: `refund-${paymentIntentId}` });
    },
  };
}

const fakePayments: Payments = {
  kind: "fake",
  async createSession({ orderId, accessKey }) {
    return { id: `fake_${orderId}`, url: siteUrl(`dev/pay?order=${orderId}&k=${accessKey}`) };
  },
  async expireSession() {},
  async refund(paymentIntentId) {
    console.log(`[fake payments] refunded ${paymentIntentId}`);
  },
};

export const fakePaymentsOn = () => !process.env.STRIPE_SECRET_KEY && process.env.FAKE_PAYMENTS === "1";

export function getPayments(): Payments | null {
  const s = stripeClient();
  if (s) return stripePayments(s);
  return fakePaymentsOn() ? fakePayments : null;
}
