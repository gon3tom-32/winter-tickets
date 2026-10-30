# Winter Performance Tickets

Reserved-seat ticketing for the Orange County Classical Academy winter performance.
Separate from the fine arts site. The fine arts site only links here.

**Status: build step 1 of 8 (seat map).** No database, no payments yet. The seating chart and prices are placeholders.

## Run it

```
npm install
npm run dev      # http://localhost:3000
npm test
```

## Where things live

| To change | Edit |
|---|---|
| Seats (the real chart, accessible seats) | `data/seats.json`, or `config/venue.json` and then `npm run seats` |
| Tier prices, which seats get which tier, seats-per-order cap, discount % | `config/pricing.json` |
| How the curved map is drawn | `GEOMETRY` in `src/lib/layout.ts` |
| Colors | top of `src/app/globals.css` |

Tier rules are checked top to bottom and the first match wins. To price the first two rows of the Left section as Premium, add this above the other rules:

```json
{ "section": "L", "rows": ["A", "B"], "tier": "premium" }
```

To mark a wheelchair space, set `"accessible": true` on that seat in `data/seats.json`. It draws as a square.

## Serving from a subpath

Set `BASE_PATH=/tickets` at build time if the app lives under another site's address.

## Build order

1. Seat map ← done
2. Database and performances (Supabase)
3. Seat holds
4. Cart and server-side pricing
5. Stripe test checkout
6. Promo codes
7. Staff area
8. Polish and launch prep
