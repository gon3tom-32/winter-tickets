import { getDb } from "./server-source";
import { readHoldToken } from "./hold-cookie";
import { loadCart, type Cart } from "./cart";
import { pricing, venue } from "./config";
import { quote } from "./pricing";

const empty = (): Cart => ({
  nights: [],
  quote: quote([], { multiNightPercent: pricing.multiNightDiscountPercent, minChargeCents: pricing.minChargeCents }),
  expiresAt: null,
});

/** This buyer's cart, or null in preview mode (no database, so no holds). */
export async function currentCart(): Promise<Cart | null> {
  const db = getDb();
  if (!db) return null;
  const token = await readHoldToken();
  if (!token) return empty();
  return loadCart(db, token, venue, {
    multiNightPercent: pricing.multiNightDiscountPercent,
    minChargeCents: pricing.minChargeCents,
  });
}
