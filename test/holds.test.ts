import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/db";
import { holdSeat, myHolds, releaseExpiredHolds, releaseSeats, splitHolds } from "@/lib/holds";
import { databaseSource } from "@/lib/source";
import { freshDb } from "./helpers";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const opts = { holdMinutes: 10, maxSeats: 4 };

let pg: PGlite;
let db: Db;
beforeEach(async () => {
  ({ pg, db } = await freshDb());
}, 30_000);

const hold = (token: string, seatId: string, performanceId = "night-1") =>
  holdSeat(db, { performanceId, seatId, token, ...opts });
const expireAll = () => pg.exec(`update performance_seats set hold_expires_at = now() - interval '1 second' where status = 'held'`);

describe("holding seats", () => {
  it("holds an open seat for about 10 minutes", async () => {
    const r = await hold(A, "C-A-1");
    expect(r.ok).toBe(true);
    const mins = (Date.parse((r as { expiresAt: string }).expiresAt) - Date.now()) / 60000;
    expect(mins).toBeGreaterThan(9.9);
    expect(mins).toBeLessThanOrEqual(10);
  });

  it("won't let a second buyer hold the same seat", async () => {
    await hold(A, "C-A-1");
    expect(await hold(B, "C-A-1")).toEqual({ ok: false, reason: "held" });
  });

  it("lets the same buyer hold a seat again without error", async () => {
    await hold(A, "C-A-1");
    expect((await hold(A, "C-A-1")).ok).toBe(true);
  });

  it("lets another buyer take a seat once its hold has expired", async () => {
    await hold(A, "C-A-1");
    await expireAll();
    expect((await hold(B, "C-A-1")).ok).toBe(true);
    expect((await myHolds(db, A)).seats).toEqual([]);
  });

  it("reports a sold seat as taken", async () => {
    const [o] = (await pg.query<{ id: string }>(`insert into orders (buyer_name, buyer_email, total_cents) values ('[T]', 't@example.com', 0) returning id`)).rows;
    await pg.query(`update performance_seats set status = 'sold', order_id = $1 where performance_id = 'night-1' and seat_id = 'C-A-2'`, [o.id]);
    expect(await hold(A, "C-A-2")).toEqual({ ok: false, reason: "taken" });
  });

  it("refuses unknown seats and nights that aren't on sale", async () => {
    expect(await hold(A, "Z-Z-99")).toEqual({ ok: false, reason: "unknown_seat" });
    await pg.exec(`update performances set on_sale = false where id = 'night-2'`);
    expect(await hold(A, "C-A-1", "night-2")).toEqual({ ok: false, reason: "not_on_sale" });
    expect(await hold(A, "C-A-1", "nope")).toEqual({ ok: false, reason: "not_on_sale" });
  });
});

describe("one shared clock per buyer", () => {
  it("gives every seat the expiry of the first one, across nights", async () => {
    const first = await hold(A, "C-A-1");
    await new Promise((r) => setTimeout(r, 30));
    const second = await hold(A, "C-A-2", "night-2");
    expect(second).toEqual(first);
    const mine = await myHolds(db, A);
    expect(mine.seats).toHaveLength(2);
    expect(mine.expiresAt).toBe((first as { expiresAt: string }).expiresAt);
  });

  it("starts a fresh clock after everything has expired", async () => {
    await hold(A, "C-A-1");
    await expireAll();
    const r = await hold(A, "C-A-2");
    expect(Date.parse((r as { expiresAt: string }).expiresAt)).toBeGreaterThan(Date.now() + 9 * 60000);
  });
});

describe("seat limit", () => {
  it("counts seats across all nights", async () => {
    for (const [seat, night] of [["C-A-1", "night-1"], ["C-A-2", "night-1"], ["C-A-1", "night-2"], ["C-A-1", "night-3"]]) {
      expect((await hold(A, seat, night)).ok).toBe(true);
    }
    expect(await hold(A, "C-A-3")).toEqual({ ok: false, reason: "limit" });
    // Holding a seat you already have doesn't count against the limit.
    expect((await hold(A, "C-A-1")).ok).toBe(true);
  });

  it("frees up room once seats are released", async () => {
    for (const seat of ["C-A-1", "C-A-2", "C-A-3", "C-A-4"]) await hold(A, seat);
    expect(await releaseSeats(db, { performanceId: "night-1", token: A, seatIds: ["C-A-1"] })).toBe(1);
    expect((await hold(A, "C-A-5")).ok).toBe(true);
  });
});

describe("releasing", () => {
  it("only releases the buyer's own seats", async () => {
    await hold(A, "C-A-1");
    await hold(B, "C-A-2");
    expect(await releaseSeats(db, { performanceId: "night-1", token: A, seatIds: ["C-A-1", "C-A-2"] })).toBe(1);
    expect((await myHolds(db, B)).seats).toHaveLength(1);
  });

  it("releases every seat for a night when no seats are listed", async () => {
    await hold(A, "C-A-1");
    await hold(A, "C-A-2");
    await hold(A, "C-A-3", "night-2");
    expect(await releaseSeats(db, { performanceId: "night-1", token: A })).toBe(2);
    expect(splitHolds(await myHolds(db, A), "night-1")).toMatchObject({ mine: [], otherNights: 1 });
  });

  it("cleanup job clears only expired holds", async () => {
    await hold(A, "C-A-1");
    await expireAll();
    await hold(B, "C-A-2");
    expect(await releaseExpiredHolds(db)).toBe(1);
    const n = (await pg.query<{ n: number }>(`select count(*)::int n from performance_seats where status = 'held'`)).rows[0].n;
    expect(n).toBe(1);
  });
});

describe("what the map shows", () => {
  it("shows other buyers' holds as held but leaves out your own", async () => {
    await hold(A, "C-A-1");
    await hold(B, "C-A-2");
    const source = databaseSource(db.query);
    expect(await source.seatStatuses("night-1", A)).toEqual({ "C-A-2": "held" });
    expect(await source.seatStatuses("night-1", null)).toEqual({ "C-A-1": "held", "C-A-2": "held" });
  });
});
