import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireStaff, clearSessionCookie, SESSION_COOKIE } from "@/lib/staff/session";
import { endSession } from "@/lib/staff/auth";
import { getDb } from "@/lib/server-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff area", robots: { index: false } };

async function signOut() {
  "use server";
  const db = getDb();
  if (db) await endSession(db, (await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect("/staff/login");
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  return (
    <div className="staff">
      <nav className="staff-nav" aria-label="Staff area">
        <div className="wrap staff-nav-inner">
          <Link href="/staff">Nights</Link>
          <Link href="/staff/codes">Promo codes</Link>
          <Link href="/staff/orders">Flagged orders</Link>
          <Link href="/staff/audit">Audit log</Link>
          {staff.role === "admin" && <Link href="/staff/users">Staff</Link>}
          <span className="staff-who">
            {staff.email} ({staff.role})
          </span>
          <form action={signOut}>
            <button className="link-button">Sign out</button>
          </form>
        </div>
      </nav>
      {children}
    </div>
  );
}
