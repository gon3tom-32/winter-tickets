import { describe, expect, it } from "vitest";
import { generateSeats } from "../scripts/generate-seats.mjs";
import { buildMap, GEOMETRY } from "@/lib/layout";
import { tierFor } from "@/lib/tiers";
import { formatCents } from "@/lib/money";
import { mapSeats, pricing, seats, venue } from "@/lib/data";
import type { Pricing } from "@/lib/types";

describe("seat data", () => {
  it("has 300 seats with unique ids", () => {
    expect(seats).toHaveLength(300);
    expect(new Set(seats.map((s) => s.id)).size).toBe(300);
  });

  it("has 50 seats in each of the six zones", () => {
    const counts: Record<string, number> = {};
    for (const s of seats) counts[`${s.section}-${s.zone}`] = (counts[`${s.section}-${s.zone}`] ?? 0) + 1;
    expect(Object.keys(counts)).toHaveLength(6);
    expect(Object.values(counts).every((n) => n === 50)).toBe(true);
  });

  it("only uses sections, zones, and rows defined in venue.json", () => {
    const sections = new Set(venue.sections.map((s) => s.id));
    for (const s of seats) {
      const zone = venue.zones.find((z) => z.id === s.zone);
      expect(sections.has(s.section)).toBe(true);
      expect(zone?.rows).toContain(s.row);
    }
  });

  it("generator output matches the committed seed file", () => {
    expect(generateSeats(venue)).toEqual(seats);
  });
});

describe("tiers", () => {
  it("assigns 50 Premium, 150 Standard, 100 Value", () => {
    const counts: Record<string, number> = {};
    for (const s of seats) counts[tierFor(s, pricing).id] = (counts[tierFor(s, pricing).id] ?? 0) + 1;
    expect(counts).toEqual({ premium: 50, standard: 150, value: 100 });
  });

  it("supports a row override placed before the zone rules", () => {
    const withOverride: Pricing = {
      ...pricing,
      tierRules: [{ section: "L", rows: ["A", "B"], tier: "premium" }, ...pricing.tierRules],
    };
    const seat = seats.find((s) => s.id === "L-A-3")!;
    expect(tierFor(seat, withOverride).id).toBe("premium");
    expect(tierFor(seats.find((s) => s.id === "L-C-3")!, withOverride).id).toBe("standard");
  });

  it("fails loudly when a seat matches no rule", () => {
    expect(() => tierFor(seats[0], { ...pricing, tierRules: [] })).toThrow(/No tier rule/);
  });
});

describe("map layout", () => {
  const map = mapSeats();

  it("keeps every seat clear of the stage", () => {
    expect(map).toHaveLength(300);
    for (const s of map) expect(Math.hypot(s.x, s.y)).toBeGreaterThan(GEOMETRY.stageRadius + GEOMETRY.seatRadius);
  });

  it("never overlaps two seats", () => {
    let min = Infinity;
    for (let i = 0; i < map.length; i++)
      for (let j = i + 1; j < map.length; j++)
        min = Math.min(min, Math.hypot(map[i].x - map[j].x, map[i].y - map[j].y));
    expect(min).toBeGreaterThan(GEOMETRY.seatRadius * 2 + 1);
  });

  it("puts the Left section on the left and numbers seats left to right", () => {
    const by = (id: string) => map.find((s) => s.id === id)!;
    expect(by("L-A-5").x).toBeLessThan(by("C-A-5").x);
    expect(by("C-A-5").x).toBeLessThan(by("R-A-5").x);
    expect(by("C-A-1").x).toBeLessThan(by("C-A-10").x);
  });

  it("draws a row with fewer seats without errors", () => {
    const fewer = seats.filter((s) => !(s.id === "C-A-10" || s.id === "C-A-9"));
    const m = buildMap(fewer, venue, pricing);
    expect(m.filter((s) => s.section === "C" && s.row === "A")).toHaveLength(8);
  });

  it("rejects a seat in a row venue.json doesn't know", () => {
    expect(() => buildMap([{ ...seats[0], row: "Z" }], venue, pricing)).toThrow(/row "Z"/);
  });
});

describe("money", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(1200)).toBe("$12.00");
    expect(formatCents(960)).toBe("$9.60");
  });
});
