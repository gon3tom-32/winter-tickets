import { NextResponse } from "next/server";
import { getDb } from "@/lib/server-source";
import { readHoldToken } from "@/lib/hold-cookie";
import { pricing, venue } from "@/lib/config";
import { abandonCheckout, attachSession, startCheckout } from "@/lib/orders";
import { getPayments, orderUrl } from "@/lib/payments";
import { sendConfirmation } from "@/lib/confirmation";

// Start checkout: { buyerName, buyerEmail, grades: { [performanceId]: string[] } }
// Answers { url } to send the buyer to (payment page, or the order page for a free order).
export async function POST(req: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, reason: "no_database" }, { status: 503 });
  const token = await readHoldToken();
  if (!token) return NextResponse.json({ ok: false, reason: "empty_cart" }, { status: 409 });

  const body = await req.json().catch(() => null);
  const grades: Record<string, string[]> = {};
  if (body?.grades && typeof body.grades === "object") {
    for (const [k, v] of Object.entries(body.grades)) {
      if (Array.isArray(v)) grades[k] = v.filter((g): g is string => typeof g === "string").slice(0, 20);
    }
  }

  const payments = getPayments();
  const result = await startCheckout(db, { token, buyerName: body?.buyerName, buyerEmail: body?.buyerEmail, grades }, { venue, pricing });
  if (!result.ok) return NextResponse.json(result, { status: 409 });
  const s = result.started;

  // Earlier unfinished payment pages for this buyer are closed so they can't be paid twice.
  if (payments) {
    await Promise.all(s.staleSessions.map((id) => payments.expireSession(id).catch(() => {})));
  }

  if (s.free) {
    await sendConfirmation(db, s.orderId);
    return NextResponse.json({ ok: true, url: orderUrl(s.orderId, s.accessKey) });
  }

  if (!payments) {
    await abandonCheckout(db, s.orderId);
    return NextResponse.json({ ok: false, reason: "payments_not_configured" }, { status: 503 });
  }

  try {
    const session = await payments.createSession({
      orderId: s.orderId,
      accessKey: s.accessKey,
      email: body.buyerEmail.trim(),
      lines: s.lines,
      expiresAt: new Date(Date.now() + pricing.checkoutMinutes * 60_000),
    });
    await attachSession(db, s.orderId, session.id);
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e) {
    console.error("Creating the payment page failed", e);
    await abandonCheckout(db, s.orderId);
    return NextResponse.json({ ok: false, reason: "payment_error" }, { status: 502 });
  }
}
