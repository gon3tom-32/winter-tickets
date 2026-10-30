import Link from "next/link";
import { notFound } from "next/navigation";
import SeatMap from "@/components/SeatMap";
import { buildMap } from "@/lib/layout";
import { venue, pricing } from "@/lib/config";
import { getSource } from "@/lib/server-source";
import { nightTitle } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function Night({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = getSource();
  const night = await source.performance(id);
  if (!night) notFound();

  const [{ seats, tiers }, statuses] = await Promise.all([source.venue(), source.seatStatuses(id)]);

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
          statuses={statuses}
        />
      ) : (
        <p className="notice">Tickets for this night aren&apos;t on sale yet.</p>
      )}
    </div>
  );
}
