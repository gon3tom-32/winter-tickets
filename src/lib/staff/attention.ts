// Orders flagged for staff, such as automatic refunds when a seat was gone by the time payment arrived.
import type { Db } from "../db";
import type { StaffUser } from "./auth";
import { logAction } from "./audit";

export type FlaggedOrder = { id: string; buyerName: string; buyerEmail: string; totalCents: number; status: string; reason: string | null; createdAt: string; refunded: boolean };

export async function flaggedOrders(db: Db): Promise<FlaggedOrder[]> {
  const rows = await db.query(`select * from orders where needs_attention order by created_at desc`);
  return rows.map((r) => ({
    id: r.id as string,
    buyerName: r.buyer_name as string,
    buyerEmail: r.buyer_email as string,
    totalCents: r.total_cents as number,
    status: r.status as string,
    reason: (r.attention_reason as string) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    refunded: r.refund_issued_at !== null,
  }));
}

export async function resolveFlag(db: Db, actor: StaffUser, orderId: string, note: string): Promise<boolean> {
  return db.transaction(async (q) => {
    const [r] = await q(`update orders set needs_attention = false where id = $1 and needs_attention returning buyer_email`, [orderId]);
    if (!r) return false;
    await logAction(q, actor.userId, "order.resolve_flag", orderId, { note: note.trim().slice(0, 500) });
    return true;
  });
}
