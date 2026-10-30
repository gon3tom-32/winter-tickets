import type { Query } from "../db";

/** Records a staff action. Audit rows can never be edited or deleted. */
export async function logAction(q: Query, actor: string | null, action: string, target: string | null, details: Record<string, unknown> = {}) {
  await q(`insert into audit_log (actor, action, target, details) values ($1, $2, $3, $4::jsonb)`, [
    actor,
    action,
    target,
    JSON.stringify(details),
  ]);
}

export type AuditEntry = { id: number; at: string; actorEmail: string | null; action: string; target: string | null; details: Record<string, unknown> };

export async function recentAudit(q: Query, limit = 200): Promise<AuditEntry[]> {
  const rows = await q(
    `select a.id, a.created_at, s.email, a.action, a.target, a.details
       from audit_log a left join staff_users s on s.user_id = a.actor
      order by a.id desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    at: new Date(r.created_at as string).toISOString(),
    actorEmail: (r.email as string) ?? null,
    action: r.action as string,
    target: (r.target as string) ?? null,
    details: (typeof r.details === "string" ? JSON.parse(r.details) : r.details) as Record<string, unknown>,
  }));
}
