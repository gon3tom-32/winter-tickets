// The per-night seat ledger: where every seat stands. The categories always add up to the seat count.
import type { Db } from "../db";
import type { Venue } from "../types";
import { seatLabel } from "../layout";

export const CATEGORIES = {
  paid: "Paid",
  discounted_code: "Discounted with a code",
  free_code: "Free with a code",
  free: "Free ($0 price)",
  comped: "Comped by staff",
  held: "Held in checkout",
  available: "Available",
} as const;
export type Category = keyof typeof CATEGORIES;

export type LedgerSeat = {
  seatId: string;
  label: string;
  category: Category;
  name: string | null;
  email: string | null;
  grades: string[];
  code: string | null;
  orderId: string | null;
  compId: string | null;
};

export type Ledger = {
  seatCount: number;
  counts: Record<Category, number>;
  balanced: boolean;
  byGrade: { grade: string; seats: number }[];
  multiGradeSeats: number;
  attendees: LedgerSeat[];
  codes: { code: string; seats: number }[];
};

export async function nightLedger(db: Db, performanceId: string, venue: Venue): Promise<Ledger> {
  const rows = await db.query(
    `select ps.seat_id, s.section, s.zone, s.row, s.number,
            case
              when ps.status = 'comped' then 'comped'
              when ps.status = 'held' and ps.hold_expires_at > now() then 'held'
              when ps.status = 'sold' and oi.price_cents = 0 and o.promo_code_id is not null then 'free_code'
              when ps.status = 'sold' and oi.price_cents = 0 then 'free'
              when ps.status = 'sold' and o.promo_code_id is not null and oi.price_cents < t.price_cents then 'discounted_code'
              when ps.status = 'sold' then 'paid'
              else 'available'
            end as category,
            coalesce(o.buyer_name, c.recipient) as name,
            o.buyer_email as email,
            coalesce(oi.grades_supported, c.grades_supported, '{}') as grades,
            case when oi.price_cents < t.price_cents then pc.code end as code,
            o.id as order_id, c.id as comp_id
       from performance_seats ps
       join seats s on s.id = ps.seat_id
       join tiers t on t.id = s.tier_id
       left join orders o on o.id = ps.order_id and ps.status = 'sold'
       left join order_items oi on oi.order_id = o.id and oi.performance_id = ps.performance_id and oi.seat_id = ps.seat_id
       left join comps c on c.performance_id = ps.performance_id and c.seat_id = ps.seat_id and c.revoked_at is null and ps.status = 'comped'
       left join promo_codes pc on pc.id = o.promo_code_id
      where ps.performance_id = $1
      order by s.section, s.row, s.number`,
    [performanceId],
  );
  const [{ n: seatCount }] = await db.query(`select count(*)::int as n from seats`);

  const counts = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0])) as Record<Category, number>;
  const grades = new Map<string, number>();
  const codes = new Map<string, number>();
  let multiGradeSeats = 0;
  const attendees: LedgerSeat[] = [];

  for (const r of rows) {
    const category = r.category as Category;
    counts[category]++;
    if (category === "available" || category === "held") continue;
    const g = r.grades as string[];
    for (const grade of g) grades.set(grade, (grades.get(grade) ?? 0) + 1);
    if (g.length > 1) multiGradeSeats++;
    if (r.code) codes.set(r.code as string, (codes.get(r.code as string) ?? 0) + 1);
    attendees.push({
      seatId: r.seat_id as string,
      label: seatLabel({ section: r.section as string, zone: r.zone as string, row: r.row as string, number: r.number as number }, venue),
      category,
      name: (r.name as string) ?? null,
      email: (r.email as string) ?? null,
      grades: g,
      code: (r.code as string) ?? null,
      orderId: (r.order_id as string) ?? null,
      compId: (r.comp_id as string) ?? null,
    });
  }
  attendees.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.label.localeCompare(b.label));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    seatCount: seatCount as number,
    counts,
    balanced: total === seatCount && rows.length === seatCount,
    byGrade: [...grades].map(([grade, seats]) => ({ grade, seats })).sort((a, b) => a.grade.localeCompare(b.grade)),
    multiGradeSeats,
    attendees,
    codes: [...codes].map(([code, seats]) => ({ code, seats })),
  };
}
