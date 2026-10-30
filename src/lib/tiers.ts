import type { Pricing, Seat, Tier } from "./types";

/** First matching rule wins. Throws if a seat matches no rule, so a gap in the rules is caught early. */
export function tierFor(seat: Seat, pricing: Pricing): Tier {
  const rule = pricing.tierRules.find(
    (r) =>
      (r.section === undefined || r.section === seat.section) &&
      (r.zone === undefined || r.zone === seat.zone) &&
      (r.rows === undefined || r.rows.includes(seat.row)),
  );
  if (!rule) throw new Error(`No tier rule matches seat ${seat.id}`);
  const tier = pricing.tiers.find((t) => t.id === rule.tier);
  if (!tier) throw new Error(`Tier rule names unknown tier "${rule.tier}"`);
  return tier;
}
