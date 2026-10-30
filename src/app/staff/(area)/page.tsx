import Link from "next/link";
import { getDb, getSource } from "@/lib/server-source";
import { nightLedger } from "@/lib/staff/ledger";
import { flaggedOrders } from "@/lib/staff/attention";
import { venue } from "@/lib/config";
import { nightTitle } from "@/lib/dates";

export default async function StaffHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const db = getDb()!;
  const { denied } = await searchParams;
  const nights = await getSource().performances();
  const [ledgers, flagged] = await Promise.all([Promise.all(nights.map((n) => nightLedger(db, n.id, venue))), flaggedOrders(db)]);

  return (
    <div className="wrap page">
      <h1>Nights</h1>
      {denied && <p className="notice">That page is for admins only.</p>}
      {flagged.length > 0 && (
        <p className="notice">
          {flagged.length} {flagged.length === 1 ? "order needs" : "orders need"} a look. <Link href="/staff/orders">See flagged orders</Link>
        </p>
      )}
      <ul className="nights">
        {nights.map((n, i) => {
          const c = ledgers[i].counts;
          const taken = c.paid + c.discounted_code + c.free_code + c.free + c.comped;
          return (
            <li key={n.id} className="night">
              <h2>{nightTitle(n)}</h2>
              <span>Grades: {n.grades.join(", ")}</span>
              <span>
                <strong>{taken}</strong> taken · {c.held} in checkout · <strong>{c.available}</strong> open of {ledgers[i].seatCount}
              </span>
              {!n.onSale && <span className="status">Not on sale</span>}
              <Link className="button" href={`/staff/night/${n.id}`}>
                Seat ledger
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
