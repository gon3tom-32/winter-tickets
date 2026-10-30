// Comps: free seats issued by staff. They come off availability like a sale.
import type { Db } from "../db";
import type { StaffUser } from "./auth";
import { logAction } from "./audit";

export type CompInput = { performanceId: string; seatIds: string[]; recipient: string; grades: string[]; reason: string };
export type CompResult =
  | { ok: true; count: number }
  | { ok: false; reason: "missing_recipient" | "missing_reason" | "missing_grades" | "no_seats" | "unknown_night" }
  | { ok: false; reason: "seats_unavailable"; seats: string[] };

const clean = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").slice(0, max) : "");

export async function issueComp(db: Db, actor: StaffUser, input: CompInput): Promise<CompResult> {
  const recipient = clean(input.recipient);
  const reason = clean(input.reason, 500);
  const seatIds = [...new Set(input.seatIds)].slice(0, 100);
  if (!recipient) return { ok: false, reason: "missing_recipient" };
  if (!reason) return { ok: false, reason: "missing_reason" };
  if (seatIds.length === 0) return { ok: false, reason: "no_seats" };

  const [night] = await db.query(`select grades from performances where id = $1`, [input.performanceId]);
  if (!night) return { ok: false, reason: "unknown_night" };
  const grades = [...new Set(input.grades)].filter((g) => (night.grades as string[]).includes(g));
  if (grades.length === 0) return { ok: false, reason: "missing_grades" };

  try {
    return await db.transaction(async (q) => {
      const taken = await q(
        `update performance_seats
            set status = 'comped', hold_token = null, hold_expires_at = null, order_id = null, updated_at = now()
          where performance_id = $1 and seat_id = any($2::text[])
            and (status = 'available' or (status = 'held' and hold_expires_at <= now()))
          returning seat_id`,
        [input.performanceId, seatIds],
      );
      if (taken.length !== seatIds.length) {
        const got = new Set(taken.map((r) => r.seat_id as string));
        throw new Unavailable(seatIds.filter((s) => !got.has(s)));
      }
      for (const seatId of seatIds) {
        await q(
          `insert into comps (performance_id, seat_id, recipient, grades_supported, reason, issued_by) values ($1, $2, $3, $4::text[], $5, $6)`,
          [input.performanceId, seatId, recipient, grades, reason, actor.userId],
        );
      }
      await logAction(q, actor.userId, "comp.issue", input.performanceId, { seats: seatIds, recipient, grades, reason });
      return { ok: true as const, count: seatIds.length };
    });
  } catch (e) {
    if (e instanceof Unavailable) return { ok: false, reason: "seats_unavailable", seats: e.seats };
    throw e;
  }
}

class Unavailable extends Error {
  constructor(public seats: string[]) {
    super("seats unavailable");
  }
}

/** Admin only: undo a comp and open the seat again. */
export async function revokeComp(db: Db, actor: StaffUser, compId: string): Promise<boolean> {
  if (actor.role !== "admin") return false;
  return db.transaction(async (q) => {
    const [c] = await q(
      `update comps set revoked_at = now(), revoked_by = $2 where id = $1 and revoked_at is null returning performance_id, seat_id, recipient`,
      [compId, actor.userId],
    );
    if (!c) return false;
    await q(
      `update performance_seats set status = 'available', updated_at = now() where performance_id = $1 and seat_id = $2 and status = 'comped'`,
      [c.performance_id, c.seat_id],
    );
    await logAction(q, actor.userId, "comp.revoke", c.performance_id as string, { seat: c.seat_id, recipient: c.recipient, compId });
    return true;
  });
}
