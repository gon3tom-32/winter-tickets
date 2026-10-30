// Builds data/seats.json from the placeholder layout in config/venue.json.
// When the real seating chart arrives, either update venue.json and rerun
// this script, or edit data/seats.json directly. The map redraws from that file.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function generateSeats(venue) {
  const seats = [];
  for (const section of venue.sections) {
    for (const zone of venue.zones) {
      for (const row of zone.rows) {
        for (let number = 1; number <= venue.seatsPerRow; number++) {
          seats.push({
            id: `${section.id}-${row}-${number}`,
            section: section.id,
            zone: zone.id,
            row,
            number,
            accessible: false,
          });
        }
      }
    }
  }
  return seats;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("..", import.meta.url);
  const venue = JSON.parse(readFileSync(new URL("config/venue.json", root), "utf8"));
  const seats = generateSeats(venue);
  writeFileSync(new URL("data/seats.json", root), JSON.stringify(seats, null, 1) + "\n");
  console.log(`Wrote ${seats.length} seats to data/seats.json`);
}
