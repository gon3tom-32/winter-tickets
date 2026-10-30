import { getDb } from "@/lib/server-source";
import { requireStaff } from "@/lib/staff/session";
import { recentAudit } from "@/lib/staff/audit";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

export default async function Audit() {
  await requireStaff();
  const entries = await recentAudit(getDb()!.query, 200);
  return (
    <div className="wrap page">
      <h1>Audit log</h1>
      <p className="lede">Every comp, code change, and staff change. Entries can&apos;t be edited or deleted. Newest first (last 200).</p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">When (Pacific)</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{when(e.at)}</td>
                <td>{e.actorEmail ?? "command line"}</td>
                <td>{e.action}</td>
                <td className="small details">
                  {Object.entries(e.details)
                    .filter(([, v]) => v !== null && v !== "")
                    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
