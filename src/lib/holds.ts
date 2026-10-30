// Seat holds: a seat is reserved for one buyer while they check out.
//
// Rules:
// - Claiming a seat is a single locked database update, so two buyers can
//   never hold the same seat. The second one gets "taken".
// - All of a buyer's seats share one expiry. The clock starts with their first
//   seat and adding seats doesn't extend it.
// - A buyer can hold at most `maxSeats` seats across all nights.
// - An expired hold counts as available, whether or not cleanup has run yet.
import type { Db, Query } from "./db";

export type HoldResult =
  | { ok: true; expiresAt: string }
  | { ok: false; reason: "taken" | "held" | "limit" | "not_on_sale" | "unknown_seat" };

export type MyHolds = { seats: { performanceId: string; seatId: string }[]; expiresAt: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isToken = (t: unknown): t is string => typeof t === "string" && UUID.test(t);

const iso = (v: unknown) => new Date(v as string | Date).toISOString();

export async function holdSeat(
  db: Db,
  opts: { performanceId: string; seatId: string; token: string; holdMinutes: number; maxSeats: number },
): Promise<HoldResult> {
  const { performanceId, seatId, token, holdMinutes, maxSeats } = opts;
  return db.transaction(async (q: Query) => {
    // One buyer at a time per token, so two quick clicks can't slip past the seat limit.
    await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [token]);

    const perf = await q(`select on_sale from performances where id = $1`, [performanceId]);
    if (!perf[0]?.on_sale) return { ok: false, reason: "not_on_sale" };

    const [mine] = await q(
      `select count(*) filter (where not (performance_id = $2 and seat_id = $3))::int as others,
              min(hold_expires_at) as expires_at
         from performance_seats
        where hold_token = $1 and status = 'held' and hold_expires_at > now()`,
      [token, performanceId, seatId],
    );
    if ((mine.others as number) >= maxSeats) return { ok: false, reason: "limit" };

    const claimed = await q(
      `update performance_seats
          set status = 'held', hold_token = $3, order_id = null, updated_at = now(),
              hold_expires_at = coalesce($4::timestamptz, now() + make_interval(mins => $5))
        where performance_id = $1 and seat_id = $2
          and (status = 'available'
               or (status = 'held' and (hold_expires_at <= now() or hold_token = $3)))
        returning hold_expires_at`,
      [performanceId, seatId, token, mine.expires_at ?? null, holdMinutes],
    );
    if (claimed[0]) return { ok: true, expiresAt: iso(claimed[0].hold_expires_at) };

    const [current] = await q(`select status from performance_seats where performance_id = $1 and seat_id = $2`, [
      performanceId,
      seatId,
    ]);
    if (!current) return { ok: false, reason: "unknown_seat" };
    return { ok: false, reason: current.status === "held" ? "held" : "taken" };
  });
}

/** Releases this buyer's holds on the given seats, or on every seat for that night if none are listed. */
export async function releaseSeats(
  db: Db,
  opts: { performanceId: string; token: string; seatIds?: string[] },
): Promise<number> {
  const rows = await db.query(
    `update performance_seats
        set status = 'available', hold_token = null, hold_expires_at = null, updated_at = now()
      where performance_id = $1 and hold_token = $2 and status = 'held'
        and ($3::text[] is null or seat_id = any($3::text[]))
      returning seat_id`,
    [opts.performanceId, opts.token, opts.seatIds ?? null],
  );
  return rows.length;
}

/** Every live hold this buyer has, across all nights. */
export async function myHolds(db: Db, token: string): Promise<MyHolds> {
  const rows = await db.query(
    `select performance_id, seat_id, hold_expires_at
       from performance_seats
      where hold_token = $1 and status = 'held' and hold_expires_at > now()
      order by performance_id, seat_id`,
    [token],
  );
  return {
    seats: rows.map((r) => ({ performanceId: r.performance_id as string, seatId: r.seat_id as string })),
    expiresAt: rows.length ? new Date(Math.min(...rows.map((r) => Date.parse(iso(r.hold_expires_at))))).toISOString() : null,
  };
}

export async function releaseExpiredHolds(db: Db): Promise<number> {
  const [row] = await db.query(`select release_expired_holds() as n`);
  return row.n as number;
}

/** This night's held seats, how many are held on other nights, and the shared expiry. */
export function splitHolds(mine: MyHolds, performanceId: string) {
  return {
    mine: mine.seats.filter((s) => s.performanceId === performanceId).map((s) => s.seatId),
    otherNights: mine.seats.filter((s) => s.performanceId !== performanceId).length,
    expiresAt: mine.expiresAt,
  };
}
