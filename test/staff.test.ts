import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/db";
import { createLoginToken, endSession, signInWithToken, staffForSession, type StaffUser } from "@/lib/staff/auth";
import { addStaff, deactivateStaff, setRole } from "@/lib/staff/users";
import { issueComp, revokeComp } from "@/lib/staff/comps";
import { createCode, deactivateCode, raiseLimit } from "@/lib/staff/codes";
import { nightLedger } from "@/lib/staff/ledger";
import { recentAudit } from "@/lib/staff/audit";
import { holdSeat } from "@/lib/holds";
import { fulfillOrder, startCheckout } from "@/lib/orders";
import { performances, pricing, venue } from "@/lib/config";
import { freshDb } from "./helpers";

let pg: PGlite;
let db: Db;
let admin: StaffUser;
let staff: StaffUser;
const [gA, gB] = performances[0].grades;

beforeEach(async () => {
  ({ pg, db } = await freshDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
  await addStaff(db, null, "Admin@School.org", "admin");
  await addStaff(db, null, "helper@school.org", "staff");
  const rows = (await pg.query<{ user_id: string; email: string; role: "admin" | "staff" }>(`select user_id, email, role from staff_users order by role`)).rows;
  admin = { userId: rows.find((r) => r.role === "admin")!.user_id, email: "admin@school.org", role: "admin" };
  staff = { userId: rows.find((r) => r.role === "staff")!.user_id, email: "helper@school.org", role: "staff" };
}, 30_000);

const actions = async () => (await recentAudit(db.query)).map((e) => e.action);

describe("signing in", () => {
  it("emails a link only to active staff, at most once a minute, matching email case-insensitively", async () => {
    expect(await createLoginToken(db, "stranger@example.com")).toBeNull();
    const first = await createLoginToken(db, "  ADMIN@school.org ");
    expect(first?.user.email).toBe("admin@school.org");
    expect(await createLoginToken(db, "admin@school.org")).toBeNull();
  });

  it("uses a link once to start a session", async () => {
    const { token } = (await createLoginToken(db, "admin@school.org"))!;
    const session = await signInWithToken(db, token);
    expect(session).toBeTruthy();
    expect(await signInWithToken(db, token)).toBeNull();
    expect(await staffForSession(db, session!)).toMatchObject({ email: "admin@school.org", role: "admin" });
    expect(await actions()).toContain("staff.sign_in");
  });

  it("refuses expired links and stores only hashes", async () => {
    const { token } = (await createLoginToken(db, "admin@school.org"))!;
    const stored = (await pg.query<{ token_hash: string }>(`select token_hash from staff_login_tokens`)).rows[0].token_hash;
    expect(stored).not.toContain(token);
    await pg.exec(`update staff_login_tokens set expires_at = now() - interval '1 second'`);
    expect(await signInWithToken(db, token)).toBeNull();
    expect(await signInWithToken(db, "made-up")).toBeNull();
  });

  it("ends sessions on sign-out and when an account is turned off", async () => {
    const s1 = await signInWithToken(db, (await createLoginToken(db, "helper@school.org"))!.token);
    await endSession(db, s1!);
    expect(await staffForSession(db, s1!)).toBeNull();

    await pg.exec(`delete from staff_login_tokens`);
    const s2 = await signInWithToken(db, (await createLoginToken(db, "helper@school.org"))!.token);
    expect(await deactivateStaff(db, admin, staff.userId)).toBe(true);
    expect(await staffForSession(db, s2!)).toBeNull();
    expect(await createLoginToken(db, "helper@school.org")).toBeNull();
  });
});

describe("staff accounts", () => {
  it("only admins manage staff, and admins can't demote or turn off themselves", async () => {
    expect(await addStaff(db, staff, "new@school.org", "staff")).toBe("denied");
    expect(await addStaff(db, admin, "new@school.org", "staff")).toBe("ok");
    expect(await addStaff(db, admin, "NEW@school.org", "admin")).toBe("exists");
    expect(await setRole(db, admin, admin.userId, "staff")).toBe(false);
    expect(await deactivateStaff(db, admin, admin.userId)).toBe(false);
    expect(await setRole(db, staff, admin.userId, "staff")).toBe(false);
    expect(await setRole(db, admin, staff.userId, "admin")).toBe(true);
    expect(await actions()).toEqual(expect.arrayContaining(["staff.add", "staff.set_role"]));
  });
});

describe("comps", () => {
  it("takes seats off sale, records who they're for, and logs it", async () => {
    const r = await issueComp(db, staff, { performanceId: "night-1", seatIds: ["C-A-1", "C-A-2"], recipient: "[Guest]", grades: [gA], reason: "[Reason]" });
    expect(r).toEqual({ ok: true, count: 2 });
    const st = (await pg.query(`select status from performance_seats where performance_id = 'night-1' and seat_id in ('C-A-1','C-A-2')`)).rows;
    expect(st).toEqual([{ status: "comped" }, { status: "comped" }]);
    const entries = await recentAudit(db.query);
    expect(entries[0]).toMatchObject({ action: "comp.issue", actorEmail: "helper@school.org", details: { seats: ["C-A-1", "C-A-2"], recipient: "[Guest]" } });
  });

  it("needs a recipient, a reason, a grade from that night, and seats", async () => {
    const base = { performanceId: "night-1", seatIds: ["C-A-1"], recipient: "[G]", grades: [gA], reason: "[R]" };
    expect(await issueComp(db, staff, { ...base, recipient: " " })).toMatchObject({ reason: "missing_recipient" });
    expect(await issueComp(db, staff, { ...base, reason: "" })).toMatchObject({ reason: "missing_reason" });
    expect(await issueComp(db, staff, { ...base, grades: ["[Grade Z]"] })).toMatchObject({ reason: "missing_grades" });
    expect(await issueComp(db, staff, { ...base, seatIds: [] })).toMatchObject({ reason: "no_seats" });
  });

  it("comps all the seats or none, if one is taken", async () => {
    await holdSeat(db, { performanceId: "night-1", seatId: "C-A-2", token: crypto.randomUUID(), holdMinutes: 10, maxSeats: 10 });
    const r = await issueComp(db, staff, { performanceId: "night-1", seatIds: ["C-A-1", "C-A-2"], recipient: "[G]", grades: [gA], reason: "[R]" });
    expect(r).toEqual({ ok: false, reason: "seats_unavailable", seats: ["C-A-2"] });
    const [s] = (await pg.query(`select status from performance_seats where performance_id = 'night-1' and seat_id = 'C-A-1'`)).rows;
    expect(s).toEqual({ status: "available" });
  });

  it("can be undone by an admin only", async () => {
    await issueComp(db, staff, { performanceId: "night-1", seatIds: ["C-A-1"], recipient: "[G]", grades: [gA], reason: "[R]" });
    const [{ id }] = (await pg.query<{ id: string }>(`select id from comps`)).rows;
    expect(await revokeComp(db, staff, id)).toBe(false);
    expect(await revokeComp(db, admin, id)).toBe(true);
    expect(await revokeComp(db, admin, id)).toBe(false);
    const [s] = (await pg.query(`select status from performance_seats where performance_id = 'night-1' and seat_id = 'C-A-1'`)).rows;
    expect(s).toEqual({ status: "available" });
    // The seat can be comped again after an undo.
    expect((await issueComp(db, staff, { performanceId: "night-1", seatIds: ["C-A-1"], recipient: "[G2]", grades: [gA], reason: "[R]" })).ok).toBe(true);
    expect(await actions()).toContain("comp.revoke");
  });
});

describe("promo code management", () => {
  const input = { code: "SPRING", kind: "percent" as const, value: 25, seatLimit: 4, reason: "[R]" };

  it("lets staff create ordinary codes but not free ones", async () => {
    expect(await createCode(db, staff, input)).toMatchObject({ ok: true });
    expect(await createCode(db, staff, { ...input, code: "FREE", value: 100 })).toEqual({ ok: false, reason: "admin_only" });
    expect(await createCode(db, staff, { ...input, code: "BIG", kind: "amount", value: 1200 })).toEqual({ ok: false, reason: "admin_only" });
    expect(await createCode(db, staff, { ...input, code: "SMALL", kind: "amount", value: 500 })).toMatchObject({ ok: true });
    expect(await createCode(db, admin, { ...input, code: "FREE", value: 100 })).toMatchObject({ ok: true });
  });

  it("checks the code, amount, limit, reason, nights, and duplicates", async () => {
    expect(await createCode(db, staff, { ...input, code: "a b" })).toEqual({ ok: false, reason: "bad_code" });
    expect(await createCode(db, staff, { ...input, value: 150 })).toEqual({ ok: false, reason: "bad_value" });
    expect(await createCode(db, staff, { ...input, seatLimit: 0 })).toEqual({ ok: false, reason: "bad_limit" });
    expect(await createCode(db, staff, { ...input, reason: " " })).toEqual({ ok: false, reason: "missing_reason" });
    expect(await createCode(db, staff, { ...input, performanceIds: ["night-9"] })).toEqual({ ok: false, reason: "unknown_night" });
    await createCode(db, staff, input);
    expect(await createCode(db, staff, { ...input, code: "spring" })).toEqual({ ok: false, reason: "duplicate" });
  });

  it("expires at the end of the chosen day, Pacific time", async () => {
    await createCode(db, staff, { ...input, expiresOn: "2026-12-20" });
    const [{ e }] = (await pg.query<{ e: string }>(`select expires_at at time zone 'America/Los_Angeles' as e from promo_codes`)).rows;
    expect(new Date(e).toISOString().slice(0, 19)).toBe("2026-12-21T00:00:00");
  });

  it("logs every change; only admins raise limits, and only upward", async () => {
    const r = await createCode(db, staff, input);
    if (!r.ok) throw new Error();
    expect(await raiseLimit(db, staff, r.id, 10)).toBe(false);
    expect(await raiseLimit(db, admin, r.id, 3)).toBe(false);
    expect(await raiseLimit(db, admin, r.id, 10)).toBe(true);
    expect(await deactivateCode(db, staff, r.id)).toBe(true);
    expect(await deactivateCode(db, staff, r.id)).toBe(false);
    expect(await actions()).toEqual(expect.arrayContaining(["promo_code.create", "promo_code.raise_limit", "promo_code.deactivate"]));
    const raise = (await recentAudit(db.query)).find((e) => e.action === "promo_code.raise_limit");
    expect(raise?.details).toMatchObject({ from: 4, to: 10 });
  });
});

describe("seat ledger", () => {
  async function buy(seats: string[], opts: { code?: string; grades?: string[] } = {}) {
    const token = crypto.randomUUID();
    for (const seatId of seats) await holdSeat(db, { performanceId: "night-1", seatId, token, holdMinutes: 10, maxSeats: 10 });
    const r = await startCheckout(db, { token, buyerName: "[Buyer]", buyerEmail: "b@example.com", grades: { "night-1": opts.grades ?? [gA] }, promoCode: opts.code }, { venue, pricing });
    if (!r.ok) throw new Error(r.reason);
    if (!r.started.free) await fulfillOrder(db, r.started.orderId, "pi");
  }

  it("splits all seats into categories that add up, with a breakdown by grade", async () => {
    await createCode(db, admin, { code: "HALF", kind: "percent", value: 50, seatLimit: 10, reason: "[R]" });
    await createCode(db, admin, { code: "FREE", kind: "percent", value: 100, seatLimit: 10, reason: "[R]" });
    await buy(["C-A-1", "C-A-2"], { grades: [gA, gB] });            // paid, supporting both grades
    await buy(["C-B-1"], { code: "HALF" });                         // discounted with a code
    await buy(["C-C-1"], { code: "FREE", grades: [gB] });           // free with a code
    await issueComp(db, staff, { performanceId: "night-1", seatIds: ["L-A-1"], recipient: "[Guest]", grades: [gB], reason: "[R]" });
    await holdSeat(db, { performanceId: "night-1", seatId: "R-A-1", token: crypto.randomUUID(), holdMinutes: 10, maxSeats: 10 });

    const l = await nightLedger(db, "night-1", venue);
    expect(l.counts).toEqual({ paid: 2, discounted_code: 1, free_code: 1, free: 0, comped: 1, held: 1, available: 294 });
    expect(l.balanced).toBe(true);
    expect(l.byGrade).toEqual([
      { grade: gA, seats: 3 },
      { grade: gB, seats: 4 },
    ]);
    expect(l.multiGradeSeats).toBe(2);
    expect(l.codes).toEqual(expect.arrayContaining([{ code: "HALF", seats: 1 }, { code: "FREE", seats: 1 }]));
    expect(l.attendees.find((a) => a.seatId === "L-A-1")).toMatchObject({ name: "[Guest]", category: "comped" });
    // Another night is untouched.
    expect((await nightLedger(db, "night-2", venue)).counts.available).toBe(300);
  });

  it("counts a seat as paid when only the multi-night discount applied", async () => {
    const token = crypto.randomUUID();
    await holdSeat(db, { performanceId: "night-1", seatId: "C-A-1", token, holdMinutes: 10, maxSeats: 10 });
    await holdSeat(db, { performanceId: "night-2", seatId: "C-A-1", token, holdMinutes: 10, maxSeats: 10 });
    const r = await startCheckout(db, { token, buyerName: "[B]", buyerEmail: "b@example.com", grades: { "night-1": [gA], "night-2": [performances[1].grades[0]] } }, { venue, pricing });
    if (!r.ok) throw new Error();
    await fulfillOrder(db, r.started.orderId, "pi");
    expect((await nightLedger(db, "night-1", venue)).counts.paid).toBe(1);
  });
});
