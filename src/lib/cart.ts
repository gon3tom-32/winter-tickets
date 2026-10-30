// The buyer's cart: every seat they hold, grouped by night, with a server-side price.
import type { Db } from "./db";
import type { Performance, Venue } from "./types";
import { quote, type Quote } from "./pricing";
import { seatLabel } from "./layout";

export type CartSeat = { seatId: string; label: string; tier: string; tierName: string; priceCents: number; paidCents: number };
export type CartNight = { performance: Performance; seats: CartSeat[] };
export type Cart = { nights: CartNight[]; quote: Quote; expiresAt: string | null };

export async function loadCart(
  db: Db,
  token: string,
  venue: Venue,
  opts: { multiNightPercent: number; minChargeCents: number },
): Promise<Cart> {
  const rows = await db.query(
    `select ps.performance_id, ps.hold_expires_at,
            s.id as seat_id, s.section, s.zone, s.row, s.number, s.accessible,
            t.id as tier_id, t.name as tier_name, t.price_cents,
            p.label, p.starts_at, p.grades, p.on_sale, p.sort
       from performance_seats ps
       join seats s on s.id = ps.seat_id
       join tiers t on t.id = s.tier_id
       join performances p on p.id = ps.performance_id
      where ps.hold_token = $1 and ps.status = 'held' and ps.hold_expires_at > now()
      order by p.sort, p.id, s.section, s.row, s.number`,
    [token],
  );

  const q = quote(
    rows.map((r) => ({ performanceId: r.performance_id as string, seatId: r.seat_id as string, priceCents: r.price_cents as number })),
    opts,
  );

  const nights: CartNight[] = [];
  rows.forEach((r, i) => {
    let night = nights.at(-1);
    if (!night || night.performance.id !== r.performance_id) {
      night = {
        performance: {
          id: r.performance_id as string,
          label: r.label as string,
          startsAt: r.starts_at ? new Date(r.starts_at as string).toISOString() : null,
          grades: r.grades as string[],
          onSale: r.on_sale as boolean,
        },
        seats: [],
      };
      nights.push(night);
    }
    night.seats.push({
      seatId: r.seat_id as string,
      label: seatLabel(
        { section: r.section as string, zone: r.zone as string, row: r.row as string, number: r.number as number },
        venue,
      ),
      tier: r.tier_id as string,
      tierName: r.tier_name as string,
      priceCents: r.price_cents as number,
      paidCents: q.paidCents[i],
    });
  });

  const times = rows.map((r) => new Date(r.hold_expires_at as string).getTime());
  return { nights, quote: q, expiresAt: times.length ? new Date(Math.min(...times)).toISOString() : null };
}

/**
 * Checks the grades chosen for each night: at least one, and only grades
 * performing that night. Returns the nights with a problem (empty means OK).
 */
export function gradeProblems(nights: CartNight[], chosen: Record<string, string[] | undefined>): string[] {
  return nights
    .filter((n) => {
      const picks = chosen[n.performance.id] ?? [];
      return picks.length === 0 || picks.some((g) => !n.performance.grades.includes(g));
    })
    .map((n) => n.performance.id);
}
