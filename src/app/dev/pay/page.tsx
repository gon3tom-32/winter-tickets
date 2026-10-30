// A stand-in for Stripe's payment page, for testing without Stripe keys.
// Only exists when FAKE_PAYMENTS=1 and no STRIPE_SECRET_KEY is set.
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/server-source";
import { getOrder, cancelOrder } from "@/lib/orders";
import { fakePaymentsOn, getPayments, orderUrl } from "@/lib/payments";
import { onPaymentConfirmed } from "@/lib/confirmation";
import { venue } from "@/lib/config";
import { formatCents } from "@/lib/money";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function FakePay({ searchParams }: { searchParams: Promise<{ order?: string; k?: string }> }) {
  const { order: id, k } = await searchParams;
  const db = getDb();
  if (!fakePaymentsOn() || !db || !id || !k) notFound();
  const order = await getOrder(db, id, k, venue);
  if (!order) notFound();

  async function pay() {
    "use server";
    if (!fakePaymentsOn()) return;
    await onPaymentConfirmed(getDb()!, getPayments()!, id!, `fake_pi_${id}`);
    redirect(orderUrl(id!, k!));
  }
  async function cancel() {
    "use server";
    redirect(siteUrl("cart?payment=cancelled"));
  }
  async function expire() {
    "use server";
    if (!fakePaymentsOn()) return;
    await cancelOrder(getDb()!, id!);
    redirect(orderUrl(id!, k!));
  }

  return (
    <div className="wrap page">
      <p className="notice">Test payment page. No card is charged. This stands in for Stripe until keys are added.</p>
      <h1>Pay {formatCents(order.totalCents)}</h1>
      <p>Order for {order.buyerName} ({order.buyerEmail})</p>
      <div className="fake-pay-actions">
        <form action={pay}><button className="button">Pay (test)</button></form>
        <form action={cancel}><button className="button secondary">Back to cart</button></form>
        <form action={expire}><button className="button secondary">Let the page expire</button></form>
      </div>
    </div>
  );
}
