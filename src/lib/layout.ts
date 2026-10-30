// The drawing rule: rows curve around the stage. The stage sits at (0, 0)
// at the top of the map; each row is an arc, farther rows have a larger radius.
// Nothing here is stored data. Change these numbers to change how the map looks.
import type { Tier, TieredSeat, Venue, MapSeat } from "./types";

export const GEOMETRY = {
  firstRowRadius: 260,
  rowSpacing: 20,
  /** Extra gap between zones (the cross aisle between Front and Back). */
  zoneGap: 16,
  /** Angle each section covers, in degrees. */
  sectionSpan: 31,
  /** Angle of the aisle between sections, in degrees. */
  aisle: 7,
  seatRadius: 6,
  stageRadius: 170,
};

const rad = (deg: number) => (deg * Math.PI) / 180;

export function buildMap(seats: TieredSeat[], venue: Venue, tiers: Tier[]): MapSeat[] {
  const g = GEOMETRY;
  const sectionOrder = venue.sections.map((s) => s.id);
  const sectionName = new Map(venue.sections.map((s) => [s.id, s.name]));
  const zoneName = new Map(venue.zones.map((z) => [z.id, z.name]));
  const tierById = new Map(tiers.map((t) => [t.id, t]));

  // Front-to-back row order, with the zone each row starts in.
  const rowOrder: { row: string; zoneIndex: number }[] = [];
  venue.zones.forEach((z, zoneIndex) => z.rows.forEach((row) => rowOrder.push({ row, zoneIndex })));
  const rowIndexOf = new Map(rowOrder.map((r, i) => [r.row, i]));
  const zoneIndexOf = new Map(rowOrder.map((r) => [r.row, r.zoneIndex]));

  // Group seats by section + row so each row spreads evenly across its section.
  const groups = new Map<string, TieredSeat[]>();
  for (const seat of seats) {
    const key = `${seat.section}|${seat.row}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(seat);
  }

  const n = sectionOrder.length;
  const out: MapSeat[] = [];
  for (const [key, rowSeats] of groups) {
    const [sectionId, row] = key.split("|");
    const sectionIndex = sectionOrder.indexOf(sectionId);
    const rowIndex = rowIndexOf.get(row);
    if (sectionIndex < 0) throw new Error(`Seat section "${sectionId}" is not in venue.json`);
    if (rowIndex === undefined) throw new Error(`Seat row "${row}" is not in venue.json`);

    const radius = g.firstRowRadius + rowIndex * g.rowSpacing + zoneIndexOf.get(row)! * g.zoneGap;
    const center = (sectionIndex - (n - 1) / 2) * (g.sectionSpan + g.aisle);
    const sorted = [...rowSeats].sort((a, b) => a.number - b.number);
    sorted.forEach((seat, i) => {
      const t = sorted.length === 1 ? 0.5 : i / (sorted.length - 1);
      const angle = rad(center - g.sectionSpan / 2 + t * g.sectionSpan);
      const tier = tierById.get(seat.tier);
      if (!tier) throw new Error(`Seat ${seat.id} has unknown tier "${seat.tier}"`);
      out.push({
        ...seat,
        tier: tier.id,
        priceCents: tier.priceCents,
        x: Math.round(radius * Math.sin(angle) * 10) / 10,
        y: Math.round(radius * Math.cos(angle) * 10) / 10,
        rowIndex,
        label: `${sectionName.get(seat.section)} ${zoneName.get(seat.zone) ?? seat.zone}, Row ${seat.row}, Seat ${seat.number}`,
      });
    });
  }
  return out;
}

export type Box = { x: number; y: number; w: number; h: number };

export function boundsOf(seats: { x: number; y: number }[], pad: number): Box {
  const xs = seats.map((s) => s.x);
  const ys = seats.map((s) => s.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}
