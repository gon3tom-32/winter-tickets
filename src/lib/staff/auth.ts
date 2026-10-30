// Staff sign-in: a one-time link by email, then a session cookie.
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db";
import { logAction } from "./audit";

export type Role = "staff" | "admin";
export type StaffUser = { userId: string; email: string; role: Role };

export const LINK_MINUTES = 15;
export const SESSION_HOURS = 12;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

/**
 * Makes a sign-in link token for an active staff email. Returns null for anyone
 * else (the caller shows the same message either way), and at most one link per minute.
 */
export async function createLoginToken(db: Db, email: string): Promise<{ token: string; user: StaffUser } | null> {
  const [u] = await db.query(`select user_id, email, role from staff_users where lower(email) = lower($1) and active`, [email.trim()]);
  if (!u) return null;
  const recent = await db.query(
    `select 1 from staff_login_tokens where user_id = $1 and created_at > now() - interval '1 minute'`,
    [u.user_id],
  );
  if (recent.length) return null;
  const token = newToken();
  await db.query(
    `insert into staff_login_tokens (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(mins => $3))`,
    [hash(token), u.user_id, LINK_MINUTES],
  );
  return { token, user: { userId: u.user_id as string, email: u.email as string, role: u.role as Role } };
}

/** Uses up a sign-in link and starts a session. Returns the session cookie value, or null. */
export async function signInWithToken(db: Db, token: string): Promise<string | null> {
  if (!token || token.length > 100) return null;
  return db.transaction(async (q) => {
    const [t] = await q(
      `update staff_login_tokens t set used_at = now()
         from staff_users s
        where t.token_hash = $1 and t.used_at is null and t.expires_at > now()
          and s.user_id = t.user_id and s.active
        returning t.user_id`,
      [hash(token)],
    );
    if (!t) return null;
    const session = newToken();
    await q(`insert into staff_sessions (id_hash, user_id, expires_at) values ($1, $2, now() + make_interval(hours => $3))`, [
      hash(session),
      t.user_id,
      SESSION_HOURS,
    ]);
    await logAction(q, t.user_id as string, "staff.sign_in", null);
    return session;
  });
}

/** The signed-in staff member for a session cookie, if the session is live and they're still active. */
export async function staffForSession(db: Db, session: string | undefined): Promise<StaffUser | null> {
  if (!session || session.length > 100) return null;
  const [u] = await db.query(
    `select s.user_id, s.email, s.role
       from staff_sessions x join staff_users s on s.user_id = x.user_id
      where x.id_hash = $1 and x.ended_at is null and x.expires_at > now() and s.active`,
    [hash(session)],
  );
  return u ? { userId: u.user_id as string, email: u.email as string, role: u.role as Role } : null;
}

export async function endSession(db: Db, session: string | undefined) {
  if (session) await db.query(`update staff_sessions set ended_at = now() where id_hash = $1`, [hash(session)]);
}
