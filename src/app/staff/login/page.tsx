import { redirect } from "next/navigation";
import { getDb } from "@/lib/server-source";
import { createLoginToken, LINK_MINUTES } from "@/lib/staff/auth";
import { currentStaff } from "@/lib/staff/session";
import { sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign in", robots: { index: false } };

async function sendLink(form: FormData) {
  "use server";
  const db = getDb();
  const email = String(form.get("email") ?? "").slice(0, 254);
  if (db && email) {
    const made = await createLoginToken(db, email);
    if (made) {
      const link = siteUrl(`staff/auth?token=${made.token}`);
      await sendEmail({
        to: made.user.email,
        subject: "Your sign-in link for Winter Performance Tickets",
        text: `Use this link to sign in to the staff area. It works once and expires in ${LINK_MINUTES} minutes.\n\n${link}\n\nIf you didn't ask for this, you can ignore it.`,
        html: `<p>Use this link to sign in to the staff area. It works once and expires in ${LINK_MINUTES} minutes.</p><p><a href="${link}">Sign in</a></p><p>If you didn't ask for this, you can ignore it.</p>`,
      }).catch((e) => console.error("Sign-in email failed", e));
    }
  }
  // Same answer whether or not the email is on the staff list.
  redirect("/staff/login?sent=1");
}

export default async function StaffLogin({ searchParams }: { searchParams: Promise<{ sent?: string; expired?: string }> }) {
  if (await currentStaff()) redirect("/staff");
  const { sent, expired } = await searchParams;
  return (
    <div className="wrap page narrow">
      <h1>Staff sign in</h1>
      {!getDb() && <p className="notice">The staff area needs the ticket database, which isn&apos;t connected.</p>}
      {expired && <p className="notice">That sign-in link has expired or was already used. Ask for a new one.</p>}
      {sent ? (
        <p className="notice" role="status">
          If that email is on the staff list, a sign-in link is on its way. It works once and expires in {LINK_MINUTES} minutes.
        </p>
      ) : (
        <form action={sendLink} className="stack">
          <label htmlFor="email" className="field">
            Your school email
            <input id="email" name="email" type="email" autoComplete="email" required />
          </label>
          <button className="button">Email me a sign-in link</button>
        </form>
      )}
    </div>
  );
}
