import venueJson from "../../config/venue.json";
import pricingJson from "../../config/pricing.json";
import seatsJson from "../../data/seats.json";
import type { Pricing, Seat, Venue } from "./types";
import { buildMap } from "./layout";

export const venue = venueJson as Venue;
export const pricing = pricingJson as Pricing;
export const seats = seatsJson as Seat[];

export function mapSeats() {
  return buildMap(seats, venue, pricing);
}
