// Where the app gets seats, nights, and seat statuses from.
// With DATABASE_URL set it reads the database. Without it, it falls back to
// the config files with every seat open, so the preview still works.
import type { Performance, SeatStatus, Tier, TieredSeat } from "./types";
import { tierFor } from "./tiers";
import { performances, pricing, seats } from "./config";

export interface Source {
  kind: "database" | "files";
  venue(): Promise<{ seats: TieredSeat[]; tiers: Tier[] }>;
  performances(): Promise<Performance[]>;
  performance(id: string): Promise<Performance | null>;
  /** Only seats that are not available. Missing seats are available. */
  seatStatuses(performanceId: string): Promise<Record<string, Exclude<SeatStatus, "available">>>;
}

/** Runs one SQL statement with $1-style parameters and returns its rows. */
export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const toPerformance = (r: Record<string, unknown>): Performance => ({
  id: r.id as string,
  label: r.label as string,
  startsAt: r.starts_at ? new Date(r.starts_at as string | Date).toISOString() : null,
  grades: r.grades as string[],
  onSale: r.on_sale as boolean,
});

export function databaseSource(query: Query): Source {
  return {
    kind: "database",
    async venue() {
      const [seatRows, tierRows] = await Promise.all([
        query(`select id, section, zone, row, number, tier_id, accessible from seats`),
        query(`select id, name, price_cents from tiers order by sort`),
      ]);
      return {
        seats: seatRows.map((r) => ({
          id: r.id as string,
          section: r.section as string,
          zone: r.zone as string,
          row: r.row as string,
          number: r.number as number,
          accessible: r.accessible as boolean,
          tier: r.tier_id as string,
        })),
        tiers: tierRows.map((r) => ({ id: r.id as string, name: r.name as string, priceCents: r.price_cents as number })),
      };
    },
    async performances() {
      return (await query(`select * from performances order by sort, starts_at`)).map(toPerformance);
    },
    async performance(id) {
      const rows = await query(`select * from performances where id = $1`, [id]);
      return rows[0] ? toPerformance(rows[0]) : null;
    },
    async seatStatuses(performanceId) {
      // An expired hold counts as available, even before the cleanup job clears it.
      const rows = await query(
        `select seat_id,
           case when status = 'comped' then 'sold' else status::text end as status
         from performance_seats
         where performance_id = $1
           and status <> 'available'
           and not (status = 'held' and hold_expires_at <= now())`,
        [performanceId],
      );
      return Object.fromEntries(rows.map((r) => [r.seat_id as string, r.status as "held" | "sold"]));
    },
  };
}

export const fileSource: Source = {
  kind: "files",
  async venue() {
    return { seats: seats.map((s) => ({ ...s, tier: tierFor(s, pricing).id })), tiers: pricing.tiers };
  },
  async performances() {
    return performances;
  },
  async performance(id) {
    return performances.find((p) => p.id === id) ?? null;
  },
  async seatStatuses() {
    return {};
  },
};
