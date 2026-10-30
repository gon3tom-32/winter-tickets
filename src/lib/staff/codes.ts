// Promo code management. Staff can create codes and turn them off; only admins
// can create 100% codes or raise a code's seat limit. Every change is logged.
import type { Db } from "../db";
import type { StaffUser } from "./auth";
import { logAction } from "./audit";

export type CodeInput = {
  code: string;
  kind: "percent" | "amount";
  /** Percent (1-100), or cents off each seat. */
  value: number;
  seatLimit: number;
  /** YYYY-MM-DD: the code works through the end of that day, Pacific time. */
  expiresOn?: string | null;
  performanceIds?: string[] | null;
  issuedTo?: string;
  reason: string;
};

export type CodeProblem =
  | "bad_code"
  | "bad_value"
  | "bad_limit"
  | "bad_date"
  | "missing_reason"
  | "unknown_night"
  | "admin_only"
  | "duplicate";

export type CodeRow = {
  id: string;
  code: string;
  kind: "percent" | "amount";
  value: number;
  seatLimit: number;
  seatsUsed: number;
  expiresAt: string | null;
  expired: boolean;
  active: boolean;
  performanceIds: string[] | null;
  issuedTo: string | null;
  reason: string | null;
  createdByEmail: string | null;
  createdAt: string;
};

/** True if the code can make a seat completely free: a 100% code, or dollars off at least the top price. */
export async function isFullDiscount(db: Db, kind: string, value: number): Promise<boolean> {
  if (kind === "percent") return value >= 100;
  const [{ max }] = await db.query(`select coalesce(max(price_cents), 0)::int as max from tiers`);
  return value >= (max as number);
}

export async function createCode(db: Db, actor: StaffUser, input: CodeInput): Promise<{ ok: true; id: string } | { ok: false; reason: CodeProblem }> {
  const code = (input.code ?? "").trim();
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(code)) return { ok: false, reason: "bad_code" };
  const value = Math.round(Number(input.value));
  if (input.kind !== "percent" && input.kind !== "amount") return { ok: false, reason: "bad_value" };
  if (!(value > 0) || (input.kind === "percent" && value > 100) || value > 100_000) return { ok: false, reason: "bad_value" };
  const seatLimit = Math.round(Number(input.seatLimit));
  if (!(seatLimit >= 1 && seatLimit <= 1000)) return { ok: false, reason: "bad_limit" };
  const expiresOn = input.expiresOn?.trim() || null;
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return { ok: false, reason: "bad_date" };
  const reason = (input.reason ?? "").trim().slice(0, 500);
  if (!reason) return { ok: false, reason: "missing_reason" };
  const nights = input.performanceIds?.length ? [...new Set(input.performanceIds)] : null;
  if (nights) {
    const found = await db.query(`select id from performances where id = any($1::text[])`, [nights]);
    if (found.length !== nights.length) return { ok: false, reason: "unknown_night" };
  }
  if (actor.role !== "admin" && (await isFullDiscount(db, input.kind, value))) return { ok: false, reason: "admin_only" };

  const dup = await db.query(`select 1 from promo_codes where lower(code) = lower($1)`, [code]);
  if (dup.length) return { ok: false, reason: "duplicate" };

  return db.transaction(async (q) => {
    const [row] = await q(
      `insert into promo_codes (code, kind, value, seat_limit, expires_at, performance_ids, issued_to, reason, created_by)
       values ($1, $2, $3, $4,
               case when $5::date is null then null else (($5::date + 1)::timestamp at time zone 'America/Los_Angeles') end,
               $6::text[], $7, $8, $9)
       returning id`,
      [code, input.kind, value, seatLimit, expiresOn, nights, input.issuedTo?.trim().slice(0, 200) || null, reason, actor.userId],
    );
    await logAction(q, actor.userId, "promo_code.create", row.id as string, {
      code,
      kind: input.kind,
      value,
      seatLimit,
      expiresOn,
      nights,
      issuedTo: input.issuedTo?.trim() || null,
      reason,
    });
    return { ok: true as const, id: row.id as string };
  });
}

export async function listCodes(db: Db): Promise<CodeRow[]> {
  const rows = await db.query(
    `select p.*, (p.expires_at is not null and p.expires_at <= now()) as expired, s.email
       from promo_codes p left join staff_users s on s.user_id = p.created_by
      order by p.active desc, p.created_at desc`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    code: r.code as string,
    kind: r.kind as CodeRow["kind"],
    value: r.value as number,
    seatLimit: r.seat_limit as number,
    seatsUsed: r.seats_used as number,
    expiresAt: r.expires_at ? new Date(r.expires_at as string).toISOString() : null,
    expired: r.expired as boolean,
    active: r.active as boolean,
    performanceIds: (r.performance_ids as string[] | null) ?? null,
    issuedTo: (r.issued_to as string) ?? null,
    reason: (r.reason as string) ?? null,
    createdByEmail: (r.email as string) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export async function deactivateCode(db: Db, actor: StaffUser, id: string): Promise<boolean> {
  return db.transaction(async (q) => {
    const [r] = await q(`update promo_codes set active = false where id = $1 and active returning code`, [id]);
    if (!r) return false;
    await logAction(q, actor.userId, "promo_code.deactivate", id, { code: r.code });
    return true;
  });
}

/** Admin only. The new limit must be higher than the current one. */
export async function raiseLimit(db: Db, actor: StaffUser, id: string, newLimit: number): Promise<boolean> {
  if (actor.role !== "admin") return false;
  const limit = Math.round(Number(newLimit));
  if (!(limit <= 1000)) return false;
  return db.transaction(async (q) => {
    const [old] = await q(`select code, seat_limit from promo_codes where id = $1 for update`, [id]);
    if (!old || !(limit > (old.seat_limit as number))) return false;
    await q(`update promo_codes set seat_limit = $2 where id = $1`, [id, limit]);
    await logAction(q, actor.userId, "promo_code.raise_limit", id, { code: old.code, from: old.seat_limit, to: limit });
    return true;
  });
}
