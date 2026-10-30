import { redirect } from "next/navigation";
import { getDb } from "@/lib/server-source";
import { requireStaff } from "@/lib/staff/session";
import { flaggedOrders, resolveFlag } from "@/lib/staff/attention";
import { formatCents } from "@/lib/money";

async function resolve(form: FormData) {
  "use server";
  const staff = await requireStaff();
  await resolveFlag(getDb()!, staff, String(form.get("id")), String(form.get("note") ?? ""));
  redirect("/staff/orders");
}

export default async function FlaggedOrders() {
  await requireStaff();
  const orders = await flaggedOrders(getDb()!);
  return (
    <div className="wrap page">
      <h1>Flagged orders</h1>
      <p className="lede">Orders that need a person to look at them, such as an automatic refund because a seat was gone by the time payment came through.</p>
      {orders.length === 0 ? (
        <p className="muted">Nothing needs attention.</p>
      ) : (
        <ul className="flagged">
          {orders.map((o) => (
            <li key={o.id} className="panel">
              <strong>{o.buyerName}</strong> · {o.buyerEmail} · {formatCents(o.totalCents)} · {o.status}
              {o.status === "refunded" && (o.refunded ? " (refund went through)" : " (refund not confirmed yet: check Stripe)")}
              <p>{o.reason}</p>
              <form action={resolve} className="resolve-form">
                <input type="hidden" name="id" value={o.id} />
                <label className="field">
                  Note (what you did)
                  <input name="note" maxLength={500} required />
                </label>
                <button className="button secondary">Mark as handled</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
