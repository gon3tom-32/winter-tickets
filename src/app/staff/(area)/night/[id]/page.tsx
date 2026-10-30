import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb, getSource } from "@/lib/server-source";
import { CATEGORIES, nightLedger, type Category } from "@/lib/staff/ledger";
import { revokeComp } from "@/lib/staff/comps";
import { requireStaff } from "@/lib/staff/session";
import { venue } from "@/lib/config";
import { nightTitle } from "@/lib/dates";

async function undoComp(form: FormData) {
  "use server";
  const staff = await requireStaff("admin");
  const night = String(form.get("night"));
  const ok = await revokeComp(getDb()!, staff, String(form.get("compId")));
  redirect(`/staff/night/${night}?msg=${ok ? "comp_undone" : "comp_not_undone"}`);
}

const MESSAGES: Record<string, string> = {
  comp_done: "Comp issued.",
  comp_undone: "Comp undone. The seat is open again.",
  comp_not_undone: "That comp couldn't be undone. It may already have been undone.",
};

export default async function NightLedger({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const staff = await requireStaff();
  const [{ id }, { msg }] = await Promise.all([params, searchParams]);
  const night = await getSource().performance(id);
  if (!night) notFound();
  const ledger = await nightLedger(getDb()!, id, venue);

  return (
    <div className="wrap page">
      <Link href="/staff" className="back">← All nights</Link>
      <h1>{nightTitle(night)}</h1>
      {msg && MESSAGES[msg] && <p className="notice" role="status">{MESSAGES[msg]}</p>}
      <p>
        <Link className="button" href={`/staff/night/${id}/comp`}>Comp seats for this night</Link>
      </p>

      <section aria-labelledby="ledger-h">
        <h2 id="ledger-h">Seat ledger</h2>
        <table className="data">
          <tbody>
            {(Object.keys(CATEGORIES) as Category[])
              .filter((k) => k !== "free" || ledger.counts.free > 0)
              .map((k) => (
                <tr key={k}>
                  <th scope="row">{CATEGORIES[k]}</th>
                  <td className="num">{ledger.counts[k]}</td>
                </tr>
              ))}
            <tr className="total-row">
              <th scope="row">Total</th>
              <td className="num">{Object.values(ledger.counts).reduce((a, b) => a + b, 0)}</td>
            </tr>
          </tbody>
        </table>
        {ledger.balanced ? (
          <p className="muted small">Adds up to all {ledger.seatCount} seats.</p>
        ) : (
          <p className="notice" role="alert">
            Warning: these don&apos;t add up to the {ledger.seatCount} seats in the venue. Check the seat data before selling more.
          </p>
        )}
        {ledger.codes.length > 0 && (
          <p className="small">Codes used: {ledger.codes.map((c) => `${c.code.toUpperCase()} (${c.seats})`).join(", ")}</p>
        )}
      </section>

      <section aria-labelledby="grades-h">
        <h2 id="grades-h">Seats by grade supported</h2>
        {ledger.byGrade.length === 0 ? (
          <p className="muted">No seats sold or comped yet.</p>
        ) : (
          <>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Grade</th>
                  <th scope="col" className="num">Seats</th>
                </tr>
              </thead>
              <tbody>
                {ledger.byGrade.map((g) => (
                  <tr key={g.grade}>
                    <td>{g.grade}</td>
                    <td className="num">{g.seats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ledger.multiGradeSeats > 0 && (
              <p className="muted small">
                {ledger.multiGradeSeats} {ledger.multiGradeSeats === 1 ? "seat supports" : "seats support"} more than one grade and
                {ledger.multiGradeSeats === 1 ? " is" : " are"} counted under each.
              </p>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="who-h">
        <h2 id="who-h">Who&apos;s coming ({ledger.attendees.length} seats)</h2>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Seat</th>
                <th scope="col">How</th>
                <th scope="col">Grades</th>
                {staff.role === "admin" && <th scope="col"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {ledger.attendees.map((a) => (
                <tr key={a.seatId}>
                  <td>
                    {a.name}
                    {a.email && <div className="muted small">{a.email}</div>}
                  </td>
                  <td>{a.label}</td>
                  <td>
                    {CATEGORIES[a.category]}
                    {a.code && ` (${a.code.toUpperCase()})`}
                  </td>
                  <td>{a.grades.join(", ")}</td>
                  {staff.role === "admin" && (
                    <td>
                      {a.compId && (
                        <form action={undoComp}>
                          <input type="hidden" name="compId" value={a.compId} />
                          <input type="hidden" name="night" value={id} />
                          <button className="link-button">Undo comp</button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
