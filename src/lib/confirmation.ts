// What happens after payment: sell the seats and email the buyer, or refund.
import QRCode from "qrcode";
import type { Db } from "./db";
import { venue } from "./config";
import { formatCents } from "./money";
import { sendEmail } from "./email";
import { orderUrl, type Payments } from "./payments";
import { claimConfirmationEmail, fulfillOrder, getOrder, releaseConfirmationClaim, type FulfillResult, type OrderView } from "./orders";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function loadById(db: Db, orderId: string): Promise<OrderView | null> {
  const [row] = await db.query(`select access_key from orders where id = $1`, [orderId]);
  return row ? getOrder(db, orderId, row.access_key as string, venue) : null;
}

export function confirmationEmail(order: OrderView, link: string) {
  const nightsText = order.nights
    .map((n) => `${n.title}\n  Supporting: ${n.grades.join(", ")}\n${n.seats.map((s) => `  - ${s.label}`).join("\n")}`)
    .join("\n\n");
  const text = `Hi ${order.buyerName},

Your seats for the Winter Performance are confirmed.

${nightsText}

Total: ${formatCents(order.totalCents)}

Show the QR code (attached, or on your order page) at the door:
${link}

Orange County Classical Academy`;

  const nightsHtml = order.nights
    .map(
      (n) => `<h3 style="margin:20px 0 4px">${esc(n.title)}</h3>
<p style="margin:0 0 6px;color:#4a5875">Supporting: ${esc(n.grades.join(", "))}</p>
<ul style="margin:0;padding-left:20px">${n.seats.map((s) => `<li>${esc(s.label)}</li>`).join("")}</ul>`,
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#14305e;max-width:560px">
<h1 style="font-size:22px">Your seats are confirmed</h1>
<p>Hi ${esc(order.buyerName)},</p>
<p>Here are your tickets for the Winter Performance.</p>
${nightsHtml}
<p style="font-size:18px;margin-top:20px"><strong>Total: ${formatCents(order.totalCents)}</strong></p>
<p>Show the QR code at the door. It's attached to this email and on your order page:</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#14305e;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">View your tickets</a></p>
<p style="color:#4a5875">Orange County Classical Academy</p>
</div>`;
  return { subject: "Your Winter Performance tickets", text, html };
}

/** Sends the confirmation email once. A failure is logged and can be retried. */
export async function sendConfirmation(db: Db, orderId: string): Promise<void> {
  const order = await loadById(db, orderId);
  if (!order || (order.status !== "paid" && order.status !== "free")) return;
  if (!(await claimConfirmationEmail(db, orderId))) return;
  try {
    const link = orderUrl(order.id, order.accessKey);
    const qr = await QRCode.toBuffer(link, { width: 400, margin: 2 });
    await sendEmail({
      to: order.buyerEmail,
      ...confirmationEmail(order, link),
      attachments: [{ filename: "ticket-qr-code.png", contentBase64: qr.toString("base64") }],
    });
  } catch (e) {
    await releaseConfirmationClaim(db, orderId);
    console.error(`Confirmation email for order ${orderId} failed`, e);
  }
}

async function sendRefundNotice(order: OrderView) {
  const text = `Hi ${order.buyerName},

We're sorry: by the time your payment came through, one or more of your seats had already been taken, so we couldn't complete your order. Your payment of ${formatCents(order.totalCents)} has been refunded in full. It can take 5 to 10 days to appear.

Please choose seats again on the ticket site.

Orange County Classical Academy`;
  await sendEmail({
    to: order.buyerEmail,
    subject: "Your Winter Performance order was refunded",
    text,
    html: `<div style="font-family:Arial,sans-serif;color:#14305e;max-width:560px">${text
      .split("\n\n")
      .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
      .join("")}</div>`,
  }).catch((e) => console.error(`Refund email for order ${order.id} failed`, e));
}

/**
 * Payment confirmed for an order. Sells the seats and emails the buyer, or, if a
 * seat is gone, refunds. Safe to run again for the same order (Stripe retries).
 */
export async function onPaymentConfirmed(db: Db, payments: Payments, orderId: string, paymentIntent: string | null): Promise<FulfillResult> {
  const result = await fulfillOrder(db, orderId, paymentIntent);
  if (result === "paid" || result === "already_done") await sendConfirmation(db, orderId);

  // Refund if this order needs one and it hasn't gone through yet (covers retries after a failed refund).
  const [o] = await db.query(
    `select status, stripe_payment_intent, refund_issued_at from orders where id = $1`,
    [orderId],
  );
  if (o?.status === "refunded" && !o.refund_issued_at && o.stripe_payment_intent) {
    await payments.refund(o.stripe_payment_intent as string);
    await db.query(`update orders set refund_issued_at = now() where id = $1`, [orderId]);
    const order = await loadById(db, orderId);
    if (order) await sendRefundNotice(order);
  }
  return result;
}
