// Promo codes.
//
// - A code covers a limited number of seats in total, across all orders (a running balance).
//   A 2-seat code covers 2 seats on one night, or 1 seat on each of 2 nights.
// - Percent codes take that percent off each covered seat. Dollar codes take that
//   amount off each covered seat (never below $0). A 100% code makes those seats free.
// - If an order has more eligible seats than the code has left, it covers the
//   most expensive ones, which is best for the buyer.
// - A code can be limited to some nights, can expire, and can be turned off.
import type { Query } from "./db";
import type { DiscountOption, PriceLine } from "./pricing";

export type PromoCode = {
  id: string;
  code: string;
  kind: "percent" | "amount";
  value: number;
  seatLimit: number;
  seatsUsed: number;
  expired: boolean;
  active: boolean;
  performanceIds: string[] | null;
};

export type PromoProblem = "not_found" | "inactive" | "expired" | "used_up" | "not_for_these_nights";

export type PromoCheck =
  | { ok: true; promo: PromoCode; option: DiscountOption; seatsCovered: number }
  | { ok: false; reason: PromoProblem };

export const normalizeCode = (code: unknown) => (typeof code === "string" ? code.trim().slice(0, 64) : "");

/** Looks a code up, ignoring upper and lower case. With lock, holds the row until the transaction ends. */
export async function findPromo(q: Query, code: string, lock = false): Promise<PromoCode | null> {
  if (!code) return null;
  const [r] = await q(
    `select id, code, kind, value, seat_limit, seats_used, active, performance_ids,
            (expires_at is not null and expires_at <= now()) as expired
       from promo_codes where lower(code) = lower($1)${lock ? " for update" : ""}`,
    [code],
  );
  if (!r) return null;
  return {
    id: r.id as string,
    code: r.code as string,
    kind: r.kind as PromoCode["kind"],
    value: r.value as number,
    seatLimit: r.seat_limit as number,
    seatsUsed: r.seats_used as number,
    expired: r.expired as boolean,
    active: r.active as boolean,
    performanceIds: (r.performance_ids as string[] | null) ?? null,
  };
}

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export function checkPromo(promo: PromoCode | null, lines: PriceLine[]): PromoCheck {
  if (!promo) return { ok: false, reason: "not_found" };
  if (!promo.active) return { ok: false, reason: "inactive" };
  if (promo.expired) return { ok: false, reason: "expired" };
  const left = promo.seatLimit - promo.seatsUsed;
  if (left <= 0) return { ok: false, reason: "used_up" };

  const eligible = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => promo.performanceIds === null || promo.performanceIds.includes(l.performanceId))
    .sort((a, b) => b.l.priceCents - a.l.priceCents || a.i - b.i)
    .slice(0, left);
  if (eligible.length === 0) return { ok: false, reason: "not_for_these_nights" };

  const covered = new Set(eligible.map((e) => e.i));
  const offByLine = lines.map((l, i) =>
    !covered.has(i) ? 0 : promo.kind === "percent" ? (l.priceCents * Math.min(promo.value, 100)) / 100 : Math.min(promo.value, l.priceCents),
  );
  const n = eligible.length;
  const what = promo.kind === "percent" ? `${Math.min(promo.value, 100)}% off` : `${money(promo.value)} off`;
  return {
    ok: true,
    promo,
    seatsCovered: n,
    option: { kind: "promo", label: `Code ${promo.code.toUpperCase()}: ${what} ${n} ${n === 1 ? "seat" : "seats"}`, offByLine },
  };
}

/** Takes seats from a code's balance. Returns false if there aren't enough left. */
export async function reservePromoSeats(q: Query, promoId: string, seats: number): Promise<boolean> {
  const rows = await q(
    `update promo_codes set seats_used = seats_used + $2
      where id = $1 and active and seats_used + $2 <= seat_limit
      returning id`,
    [promoId, seats],
  );
  return rows.length > 0;
}

/** Gives an order's code seats back to the code. Safe to call more than once. */
export async function releasePromoSeats(q: Query, orderId: string): Promise<void> {
  const rows = await q(
    `update orders set promo_released_at = now()
      where id = $1 and promo_code_id is not null and promo_seats > 0 and promo_released_at is null
      returning promo_code_id, promo_seats`,
    [orderId],
  );
  if (rows[0]) {
    await q(`update promo_codes set seats_used = greatest(seats_used - $2, 0) where id = $1`, [rows[0].promo_code_id, rows[0].promo_seats]);
  }
}

/**
 * An order whose code seats were given back is being paid after all (an old
 * payment page): take the seats from the code again. False if it has none left.
 */
export async function retakePromoSeats(q: Query, orderId: string): Promise<boolean> {
  const [o] = await q(`select promo_code_id, promo_seats, promo_released_at from orders where id = $1`, [orderId]);
  if (!o?.promo_released_at) return true;
  const [p] = await q(`select id from promo_codes where id = $1 for update`, [o.promo_code_id]);
  const ok = await q(
    `update promo_codes set seats_used = seats_used + $2 where id = $1 and seats_used + $2 <= seat_limit returning id`,
    [p.id, o.promo_seats],
  );
  if (!ok.length) return false;
  await q(`update orders set promo_released_at = null where id = $1`, [orderId]);
  return true;
}
