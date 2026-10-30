// Server only: who is signed in to the staff area.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../server-source";
import { staffForSession, type Role, type StaffUser } from "./auth";
import { SESSION_HOURS } from "./auth";

export const SESSION_COOKIE = "staff_session";

export async function currentStaff(): Promise<StaffUser | null> {
  const db = getDb();
  if (!db) return null;
  return staffForSession(db, (await cookies()).get(SESSION_COOKIE)?.value);
}

/** Use at the top of every staff page and staff action. Sends anyone else to the sign-in page. */
export async function requireStaff(role: Role = "staff"): Promise<StaffUser> {
  const staff = await currentStaff();
  if (!staff) redirect("/staff/login");
  if (role === "admin" && staff.role !== "admin") redirect("/staff?denied=1");
  return staff;
}

export async function setSessionCookie(value: string) {
  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
