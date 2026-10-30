// Staff accounts. Only admins manage them. Accounts are turned off, never deleted.
import type { Db } from "../db";
import type { Role, StaffUser } from "./auth";
import { logAction } from "./audit";

export type StaffRow = { userId: string; email: string; role: Role; active: boolean; createdAt: string };

export async function listStaff(db: Db): Promise<StaffRow[]> {
  const rows = await db.query(`select user_id, email, role, active, created_at from staff_users order by active desc, email`);
  return rows.map((r) => ({
    userId: r.user_id as string,
    email: r.email as string,
    role: r.role as Role,
    active: r.active as boolean,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addStaff(db: Db, actor: StaffUser | null, email: string, role: Role): Promise<"ok" | "bad_email" | "exists" | "denied"> {
  if (actor && actor.role !== "admin") return "denied";
  const e = email.trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 254) return "bad_email";
  if (role !== "staff" && role !== "admin") return "denied";
  return db.transaction(async (q) => {
    const existing = await q(`select user_id, active from staff_users where lower(email) = $1`, [e]);
    if (existing[0]?.active) return "exists" as const;
    let id: string;
    if (existing[0]) {
      id = existing[0].user_id as string;
      await q(`update staff_users set active = true, role = $2 where user_id = $1`, [id, role]);
    } else {
      [{ user_id: id }] = (await q(`insert into staff_users (email, role) values ($1, $2) returning user_id`, [e, role])) as { user_id: string }[];
    }
    await logAction(q, actor?.userId ?? null, "staff.add", id, { email: e, role, via: actor ? "staff area" : "command line" });
    return "ok" as const;
  });
}

export async function setRole(db: Db, actor: StaffUser, userId: string, role: Role): Promise<boolean> {
  if (actor.role !== "admin" || userId === actor.userId || (role !== "staff" && role !== "admin")) return false;
  return db.transaction(async (q) => {
    const [r] = await q(`update staff_users set role = $2 where user_id = $1 returning email`, [userId, role]);
    if (!r) return false;
    await logAction(q, actor.userId, "staff.set_role", userId, { email: r.email, role });
    return true;
  });
}

/** Turns an account off and ends its sessions. Admins can't turn themselves off. */
export async function deactivateStaff(db: Db, actor: StaffUser, userId: string): Promise<boolean> {
  if (actor.role !== "admin" || userId === actor.userId) return false;
  return db.transaction(async (q) => {
    const [r] = await q(`update staff_users set active = false where user_id = $1 and active returning email`, [userId]);
    if (!r) return false;
    await q(`update staff_sessions set ended_at = now() where user_id = $1 and ended_at is null`, [userId]);
    await logAction(q, actor.userId, "staff.deactivate", userId, { email: r.email });
    return true;
  });
}
