// Runs the real migration and seed against an in-memory Postgres (PGlite).
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { buildSeedSql } from "@/lib/seed";
import { databaseSource, type Source } from "@/lib/source";
import { performances, pricing, seats } from "@/lib/config";

let db: PGlite;
let source: Source;
const schema = readFileSync(new URL("../supabase/migrations/0001_schema.sql", import.meta.url), "utf8");
const seed = buildSeedSql(seats, pricing, performances);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(schema);
  await db.exec(seed);
  source = databaseSource(async (text, params) => (await db.query<Record<string, unknown>>(text, params)).rows);
}, 30_000);

const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);

async function sellSeat(performanceId: string, seatId: string) {
  const order = await db.query<{ id: string }>(
    `insert into orders (buyer_name, buyer_email, total_cents, status) values ('[Test]', 'test@example.com', 1000, 'paid') returning id`,
  );
  await db.query(`update performance_seats set status = 'sold', order_id = $3 where performance_id = $1 and seat_id = $2`, [
    performanceId,
    seatId,
    order.rows[0].id,
  ]);
}

describe("seed", () => {
  it("loads 300 seats, 3 tiers, and every seat for every night", async () => {
    expect(await count(`select count(*) n from seats`)).toBe(300);
    expect(await count(`select count(*) n from tiers`)).toBe(3);
    expect(await count(`select count(*) n from performance_seats`)).toBe(300 * performances.length);
    expect(await count(`select count(*) n from performance_seats where status <> 'available'`)).toBe(0);
  });

  it("stores the tier each seat gets from the tier rules", async () => {
    const rows = (await db.query<{ tier_id: string; n: number }>(`select tier_id, count(*)::int n from seats group by 1 order by 1`)).rows;
    expect(rows).toEqual([
      { tier_id: "premium", n: 50 },
      { tier_id: "standard", n: 150 },
      { tier_id: "value", n: 100 },
    ]);
  });

  it("can run again without resetting sold seats", async () => {
    await sellSeat("night-2", "R-J-1");
    await db.exec(seed);
    expect(await count(`select count(*) n from performance_seats where status = 'sold' and seat_id = 'R-J-1'`)).toBe(1);
    expect(await count(`select count(*) n from performance_seats`)).toBe(300 * performances.length);
  });
});

describe("seat statuses", () => {
  it("are kept separately for each night", async () => {
    await sellSeat("night-1", "C-C-5");
    expect((await source.seatStatuses("night-1"))["C-C-5"]).toBe("sold");
    expect((await source.seatStatuses("night-3"))["C-C-5"]).toBeUndefined();
  });

  it("show comped seats as sold, and live holds as held", async () => {
    await db.exec(`
      update performance_seats set status = 'comped' where performance_id = 'night-1' and seat_id = 'L-A-1';
      update performance_seats set status = 'held', hold_token = gen_random_uuid(), hold_expires_at = now() + interval '10 minutes'
        where performance_id = 'night-1' and seat_id = 'L-A-2';`);
    const st = await source.seatStatuses("night-1");
    expect(st["L-A-1"]).toBe("sold");
    expect(st["L-A-2"]).toBe("held");
  });

  it("treat an expired hold as available", async () => {
    await db.exec(`update performance_seats set status = 'held', hold_token = gen_random_uuid(), hold_expires_at = now() - interval '1 minute'
      where performance_id = 'night-1' and seat_id = 'L-A-3'`);
    expect((await source.seatStatuses("night-1"))["L-A-3"]).toBeUndefined();
  });
});

describe("rules enforced by the database", () => {
  it("won't let a seat be listed twice for one night", async () => {
    await expect(db.query(`insert into performance_seats (performance_id, seat_id) values ('night-1', 'C-A-1')`)).rejects.toThrow(
      /duplicate key/,
    );
  });

  it("won't mark a seat held without an expiry", async () => {
    await expect(
      db.query(`update performance_seats set status = 'held' where performance_id = 'night-1' and seat_id = 'C-A-2'`),
    ).rejects.toThrow(/check constraint/);
  });

  it("won't mark a seat sold without an order", async () => {
    await expect(
      db.query(`update performance_seats set status = 'sold' where performance_id = 'night-1' and seat_id = 'C-A-3'`),
    ).rejects.toThrow(/check constraint/);
  });

  it("never lets audit log rows be edited or deleted", async () => {
    await db.exec(`insert into audit_log (action, target) values ('test', 'x')`);
    await expect(db.query(`update audit_log set action = 'changed'`)).rejects.toThrow(/audit_log rows cannot be updated/);
    await expect(db.query(`delete from audit_log`)).rejects.toThrow(/audit_log rows cannot be deleted/);
  });

  it("never lets a promo code be deleted, and matches codes regardless of case", async () => {
    await db.exec(`insert into promo_codes (code, kind, value, seat_limit) values ('WINTER', 'percent', 50, 2)`);
    await expect(db.query(`delete from promo_codes`)).rejects.toThrow(/promo_codes rows cannot be deleted/);
    await expect(db.query(`insert into promo_codes (code, kind, value, seat_limit) values ('winter', 'amount', 100, 1)`)).rejects.toThrow(
      /duplicate key/,
    );
  });

  it("won't let a code be used for more seats than its limit", async () => {
    await expect(db.query(`update promo_codes set seats_used = 3 where code = 'WINTER'`)).rejects.toThrow(/check constraint/);
  });
});

describe("database source", () => {
  it("returns nights in order with their grades", async () => {
    const nights = await source.performances();
    expect(nights.map((n) => n.id)).toEqual(performances.map((p) => p.id));
    expect(nights[0].grades).toEqual(performances[0].grades);
    expect(await source.performance("nope")).toBeNull();
  });

  it("returns seats with the tier stored in the database", async () => {
    const { seats: dbSeats, tiers } = await source.venue();
    expect(dbSeats).toHaveLength(300);
    expect(dbSeats.find((s) => s.id === "C-A-1")?.tier).toBe("premium");
    expect(tiers.map((t) => t.priceCents)).toEqual([1200, 1000, 800]);
  });
});
