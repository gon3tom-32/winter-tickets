import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getDb } from "@/lib/server-source";
import { getOrder } from "@/lib/orders";
import { orderUrl } from "@/lib/payments";
import { venue } from "@/lib/config";
import { formatCents } from "@/lib/money";
import RefreshWhilePending from "@/components/RefreshWhilePending";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const [{ id }, { k }] = await Promise.all([params, searchParams]);
  const db = getDb();
  if (!db || !k) notFound();
  const order = await getOrder(db, id, k, venue);
  if (!order) notFound();

  const confirmed = order.status === "paid" || order.status === "free";
  const qrSvg = confirmed ? await QRCode.toString(orderUrl(order.id, order.accessKey), { type: "svg", margin: 1 }) : "";

  return (
    <div className="wrap page order">
      {order.status === "pending" && (
        <>
          <h1>Confirming your payment…</h1>
          <p className="lede">This usually takes a few seconds. This page updates on its own.</p>
          <RefreshWhilePending />
        </>
      )}
      {confirmed && (
        <>
          <h1>You&apos;re all set</h1>
          <p className="lede">
            Thank you, {order.buyerName}. We&apos;ve emailed your tickets to <strong>{order.buyerEmail}</strong>. Show this QR
            code at the door.
          </p>
          <div className="qr" role="img" aria-label="QR code for check-in" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        </>
      )}
      {order.status === "refunded" && (
        <>
          <h1>Your order was refunded</h1>
          <p className="lede">
            By the time your payment came through, a seat in your order had already been taken, so we couldn&apos;t complete
            it. Your payment has been refunded in full. Please choose seats again.
          </p>
          <Link href="/" className="button">Choose seats</Link>
        </>
      )}
      {order.status === "cancelled" && (
        <>
          <h1>This order wasn&apos;t completed</h1>
          <p className="lede">No payment was taken. If your seats are still held, you can finish from your cart.</p>
          <Link href="/cart" className="button">Go to cart</Link>
        </>
      )}

      <section className="order-details" aria-labelledby="order-seats">
        <h2 id="order-seats">{confirmed ? "Your tickets" : "Order details"}</h2>
        {order.nights.map((n) => (
          <div key={n.performanceId} className="order-night">
            <h3>{n.title}</h3>
            <p className="muted">Supporting: {n.grades.join(", ")}</p>
            <ul>
              {n.seats.map((s) => (
                <li key={s.seatId}>{s.label}</li>
              ))}
            </ul>
          </div>
        ))}
        <p className="subtotal">
          <span>Total {order.status === "free" ? "(no payment needed)" : ""}</span>
          <strong>{formatCents(order.totalCents)}</strong>
        </p>
      </section>
    </div>
  );
}
