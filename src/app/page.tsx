import SeatMap from "@/components/SeatMap";
import { mapSeats, pricing, venue } from "@/lib/data";

export default function Home() {
  return (
    <div className="wrap page">
      <p className="eyebrow">[Night and date] · [Time]</p>
      <h1>Choose your seats</h1>
      <p className="lede">Grades performing: [Grades]. Seats are reserved. Pick a section, then tap the seats you want.</p>
      <SeatMap
        seats={mapSeats()}
        sections={venue.sections}
        tiers={pricing.tiers}
        maxSeats={pricing.maxSeatsPerOrder}
      />
    </div>
  );
}
