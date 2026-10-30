import { redirect } from "next/navigation";
import { getDb, getSource } from "@/lib/server-source";
import { requireStaff } from "@/lib/staff/session";
import { createCode, deactivateCode, listCodes, raiseLimit, type CodeRow } from "@/lib/staff/codes";
import { formatCents } from "@/lib/money";
import { nightTitle } from "@/lib/dates";

const MESSAGES: Record<string, string> = {
  created: "Code created.",
  deactivated: "Code turned off.",
  raised: "Seat limit raised.",
  not_raised: "The new limit has to be higher than the current one (up to 1000).",
  bad_code: "Codes are 3 to 32 letters, numbers, dashes, or underscores.",
  bad_value: "Enter a percent from 1 to 100, or a dollar amount above $0.",
  bad_limit: "The seat limit must be from 1 to 1000.",
  bad_date: "Enter the expiry as a date.",
  missing_reason: "Enter a reason for the code.",
  unknown_night: "One of those nights doesn't exist.",
  admin_only: "Only an admin can create a code that makes seats free (100% off, or dollars off the full price).",
  duplicate: "That code already exists. Codes are never reused, even after they're turned off.",
};

async function create(form: FormData) {
  "use server";
  const staff = await requireStaff();
  const kind = form.get("kind") === "amount" ? "amount" : "percent";
  const raw = Number(form.get("value"));
  const result = await createCode(getDb()!, staff, {
    code: String(form.get("code") ?? ""),
    kind,
    value: kind === "amount" ? Math.round(raw * 100) : raw,
    seatLimit: Number(form.get("seatLimit")),
    expiresOn: String(form.get("expiresOn") ?? "") || null,
    performanceIds: form.getAll("nights").map(String),
    issuedTo: String(form.get("issuedTo") ?? ""),
    reason: String(form.get("reason") ?? ""),
  });
  redirect(`/staff/codes?msg=${result.ok ? "created" : result.reason}`);
}

async function deactivate(form: FormData) {
  "use server";
  const staff = await requireStaff();
  await deactivateCode(getDb()!, staff, String(form.get("id")));
  redirect("/staff/codes?msg=deactivated");
}

async function raise(form: FormData) {
  "use server";
  const staff = await requireStaff("admin");
  const ok = await raiseLimit(getDb()!, staff, String(form.get("id")), Number(form.get("limit")));
  redirect(`/staff/codes?msg=${ok ? "raised" : "not_raised"}`);
}

const describe = (c: CodeRow) => (c.kind === "percent" ? `${c.value}% off` : `${formatCents(c.value)} off`) + " each seat";
const dateText = (iso: string) =>
  new Date(new Date(iso).getTime() - 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

export default async function Codes({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const staff = await requireStaff();
  const { msg } = await searchParams;
  const [codes, nights] = await Promise.all([listCodes(getDb()!), getSource().performances()]);
  const nightName = new Map(nights.map((n) => [n.id, nightTitle(n)]));

  return (
    <div className="wrap page">
      <h1>Promo codes</h1>
      {msg && MESSAGES[msg] && <p className="notice" role="status">{MESSAGES[msg]}</p>}

      <details className="panel" open={codes.length === 0 || (msg !== undefined && msg !== "created" && msg !== "deactivated" && msg !== "raised")}>
        <summary>Create a code</summary>
        <form action={create} className="code-form">
          <label className="field">
            Code
            <input name="code" required pattern="[A-Za-z0-9_\-]{3,32}" autoCapitalize="characters" spellCheck={false} />
          </label>
          <fieldset className="field inline-choices">
            <legend>Discount</legend>
            <label><input type="radio" name="kind" value="percent" defaultChecked /> Percent off each seat</label>
            <label><input type="radio" name="kind" value="amount" /> Dollars off each seat</label>
          </fieldset>
          <label className="field">
            Amount (percent, or dollars)
            <input name="value" type="number" min="0.01" step="0.01" required />
          </label>
          <label className="field">
            Seat limit (total, across all orders)
            <input name="seatLimit" type="number" min="1" max="1000" required />
          </label>
          <label className="field">
            Expires after (optional)
            <input name="expiresOn" type="date" />
          </label>
          <fieldset className="field inline-choices">
            <legend>Nights (leave all unchecked for every night)</legend>
            {nights.map((n) => (
              <label key={n.id}><input type="checkbox" name="nights" value={n.id} /> {nightTitle(n)}</label>
            ))}
          </fieldset>
          <label className="field">
            Who it&apos;s for (optional)
            <input name="issuedTo" maxLength={200} />
          </label>
          <label className="field">
            Reason
            <input name="reason" required maxLength={500} />
          </label>
          {staff.role !== "admin" && <p className="muted small">Codes that make seats free need an admin.</p>}
          <button className="button">Create code</button>
        </form>
      </details>

      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Discount</th>
              <th scope="col" className="num">Seats used</th>
              <th scope="col">Limits</th>
              <th scope="col">For / reason</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id} className={c.active && !c.expired ? "" : "inactive"}>
                <td>
                  <strong>{c.code.toUpperCase()}</strong>
                  <div className="small muted">{!c.active ? "Off" : c.expired ? "Expired" : c.seatsUsed >= c.seatLimit ? "Used up" : "Active"}</div>
                </td>
                <td>{describe(c)}</td>
                <td className="num">
                  {c.seatsUsed} of {c.seatLimit}
                </td>
                <td className="small">
                  {c.performanceIds ? c.performanceIds.map((id) => nightName.get(id) ?? id).join(", ") : "All nights"}
                  {c.expiresAt && <div>Through {dateText(c.expiresAt)}</div>}
                </td>
                <td className="small">
                  {c.issuedTo && <div>{c.issuedTo}</div>}
                  <div className="muted">{c.reason}</div>
                  <div className="muted">by {c.createdByEmail ?? "command line"}</div>
                </td>
                <td className="actions">
                  {c.active && (
                    <form action={deactivate}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="link-button">Turn off</button>
                    </form>
                  )}
                  {staff.role === "admin" && c.active && (
                    <form action={raise} className="raise-form">
                      <input type="hidden" name="id" value={c.id} />
                      <label>
                        <span className="sr-only">New seat limit for {c.code}</span>
                        <input name="limit" type="number" min={c.seatLimit + 1} max={1000} placeholder={`> ${c.seatLimit}`} required />
                      </label>
                      <button className="link-button">Raise limit</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
