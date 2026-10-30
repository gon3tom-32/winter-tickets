// The page a sign-in link opens. Signing in takes a button press, because some
// email programs open links on their own to check them, which would use up the link.
import { redirect } from "next/navigation";
import { getDb } from "@/lib/server-source";
import { signInWithToken } from "@/lib/staff/auth";
import { setSessionCookie } from "@/lib/staff/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign in", robots: { index: false } };

async function signIn(form: FormData) {
  "use server";
  const db = getDb();
  const session = db ? await signInWithToken(db, String(form.get("token") ?? "")) : null;
  if (!session) redirect("/staff/login?expired=1");
  await setSessionCookie(session);
  redirect("/staff");
}

export default async function StaffAuth({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="wrap page narrow">
      <h1>Sign in to the staff area</h1>
      <form action={signIn}>
        <input type="hidden" name="token" value={token ?? ""} />
        <button className="button">Sign in</button>
      </form>
    </div>
  );
}
