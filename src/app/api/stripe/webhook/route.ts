// Stripe calls this when a payment completes or a payment page expires.
// Seats are marked sold here, and only here, for card payments.
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@/lib/server-source";
import { getPayments, stripeClient } from "@/lib/payments";
import { onPaymentConfirmed } from "@/lib/confirmation";
import { cancelOrder } from "@/lib/orders";

export async function POST(req: Request) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const db = getDb();
  const payments = getPayments();
  if (!stripe || !secret || !db || !payments) {
    return NextResponse.json({ error: "Payments are not set up" }, { status: 503 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  // Already handled? Stripe sometimes sends the same event twice.
  const seen = await db.query(`select 1 from stripe_events where id = $1`, [event.id]);
  if (seen.length) return NextResponse.json({ received: true, duplicate: true });

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id ?? session.client_reference_id;
    if (orderId && session.payment_status === "paid") {
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      await onPaymentConfirmed(db, payments, orderId, pi);
    }
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id ?? session.client_reference_id;
    if (orderId) await cancelOrder(db, orderId);
  }

  // Recorded only after handling succeeded, so a failure gets retried by Stripe.
  await db.query(`insert into stripe_events (id, type) values ($1, $2) on conflict do nothing`, [event.id, event.type]);
  return NextResponse.json({ received: true });
}
