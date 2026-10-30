// The config files, typed. These are the editable settings.
import venueJson from "../../config/venue.json";
import pricingJson from "../../config/pricing.json";
import performancesJson from "../../config/performances.json";
import seatsJson from "../../data/seats.json";
import type { Performance, Pricing, Seat, Venue } from "./types";

export const venue = venueJson as Venue;
export const pricing = pricingJson as Pricing;
export const seats = seatsJson as Seat[];
export const performances = performancesJson.performances as Performance[];
