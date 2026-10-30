export type Seat = {
  id: string;
  section: string;
  zone: string;
  row: string;
  number: number;
  accessible: boolean;
};

export type Section = { id: string; name: string };
export type Zone = { id: string; name: string; rows: string[] };
export type Venue = { name: string; sections: Section[]; zones: Zone[]; seatsPerRow: number };

export type Tier = { id: string; name: string; priceCents: number };
export type TierRule = { section?: string; zone?: string; rows?: string[]; tier: string };
export type Pricing = {
  tiers: Tier[];
  tierRules: TierRule[];
  multiNightDiscountPercent: number;
  maxSeatsPerOrder: number;
  holdMinutes: number;
};

/** A seat with its tier resolved and its position on the map worked out. */
export type MapSeat = Seat & {
  tier: string;
  priceCents: number;
  x: number;
  y: number;
  /** Position counted from the stage, 0 = front row. Used for keyboard moves. */
  rowIndex: number;
  label: string;
};
