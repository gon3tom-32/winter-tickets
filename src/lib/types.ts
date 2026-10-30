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
  /** Smallest card charge allowed, in cents (Stripe: 50). */
  minChargeCents: number;
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

export type Performance = {
  id: string;
  label: string;
  /** ISO date-time, or null while the date is still a placeholder. */
  startsAt: string | null;
  grades: string[];
  onSale: boolean;
};

/** What the public map shows. Comped seats show as sold. */
export type SeatStatus = "available" | "held" | "sold";

/** A seat with its tier already decided (from the database, or from the tier rules). */
export type TieredSeat = Seat & { tier: string };
