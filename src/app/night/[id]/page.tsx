import Link from "next/link";
import { notFound } from "next/navigation";
import SeatMap from "@/components/SeatMap";
import { buildMap } from "@/lib/layout";
import { venue, pricing } from "@/lib/config";
import { getDb, getSource } from "@/lib/server-source";
import { myHolds, splitHolds } from "@/lib/holds";
import { readHoldToken } from "@/lib/hold-cookie";
import { nightTitle } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function Night({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = getSource();
  const night = await source.performance(id);
  if (!night) notFound();

  const db = getDb();
  const token = await readHoldToken();
  const [{ seats, tiers }, statuses, mine] = await Promise.all([
    source.venue(),
    source.seatStatuses(id, token),
    db && token ? myHolds(db, token) : { seats: [], expiresAt: null },
  ]);

  return (
    <div className="wrap page">
      <Link href="/" className="back">← All nights</Link>
      <p className="eyebrow">{nightTitle(night)}</p>
      <h1>Choose your seats</h1>
      <p className="lede">Grades performing: {night.grades.join(", ")}. Seats are reserved. Pick a section, then tap the seats you want.</p>
      {night.onSale ? (
        <SeatMap
          key={night.id}
          seats={buildMap(seats, venue, tiers)}
          sections={venue.sections}
          tiers={tiers}
          maxSeats={pricing.maxSeatsPerOrder}
          performanceId={night.id}
          holdsEnabled={db !== null}
          holdMinutes={pricing.holdMinutes}
          initial={{ statuses, ...splitHolds(mine, night.id) }}
        />
      ) : (
        <p className="notice">Tickets for this night aren&apos;t on sale yet.</p>
      )}
    </div>
  );
}
