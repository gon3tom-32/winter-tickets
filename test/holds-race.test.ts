// Many buyers clicking at the same moment, against a real Postgres server.
// Runs only when TEST_DATABASE_URL is set, because it needs real parallel connections.
// The database is wiped, so never point this at a database with real data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { Db } from "@/lib/db";
import { holdSeat } from "@/lib/holds";
import { startCheckout } from "@/lib/orders";
import { performances, pricing, venue } from "@/lib/config";
import { migrations, seedSql } from "./helpers";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("seat holds under load", () => {
  let sql: postgres.Sql;
  let db: Db;

  beforeAll(async () => {
    sql = postgres(url!, { max: 30, onnotice: () => {} });
    await sql.unsafe(`drop schema public cascade; create schema public;`);
    for (const m of migrations) await sql.unsafe(m);
    const one = postgres(url!, { max: 1, onnotice: () => {} });
    await one.unsafe(seedSql);
    await one.end();
    const run = (s: postgres.Sql | postgres.TransactionSql) => (text: string, params?: unknown[]) =>
      s.unsafe(text, (params ?? []) as never[]) as unknown as Promise<Record<string, unknown>[]>;
    db = { query: run(sql), transaction: (fn) => sql.begin((tx) => fn(run(tx))) as never };
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("gives a contested seat to exactly one of 25 buyers", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        holdSeat(db, { performanceId: "night-1", seatId: "C-E-5", token: crypto.randomUUID(), holdMinutes: 10, maxSeats: 10 }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "held")).toBe(true);
  });

  it("never lets one buyer go over the seat limit, even clicking 20 seats at once", async () => {
    const token = crypto.randomUUID();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        holdSeat(db, { performanceId: "night-2", seatId: i < 10 ? `L-F-${i + 1}` : `L-G-${i - 9}`, token, holdMinutes: 10, maxSeats: 10 }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    const [{ n }] = await sql`select count(*)::int n from performance_seats where hold_token = ${token}`;
    expect(n).toBe(10);
  });

  it("lets only one of 10 buyers checking out at once use a code's last seat", async () => {
    await sql`insert into promo_codes (code, kind, value, seat_limit) values ('LAST1', 'percent', 50, 1)`;
    const tokens = Array.from({ length: 10 }, () => crypto.randomUUID());
    await Promise.all(
      tokens.map((token, i) =>
        holdSeat(db, { performanceId: "night-3", seatId: `R-H-${i + 1}`, token, holdMinutes: 10, maxSeats: 10 }),
      ),
    );
    const results = await Promise.all(
      tokens.map((token) =>
        startCheckout(
          db,
          { token, buyerName: "[T]", buyerEmail: "t@example.com", grades: { "night-3": [performances[2].grades[0]] }, promoCode: "LAST1" },
          { venue, pricing },
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "promo_invalid")).toHaveLength(9);
    const [{ n }] = await sql`select seats_used n from promo_codes where code = 'LAST1'`;
    expect(n).toBe(1);
  });
});
