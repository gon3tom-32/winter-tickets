# Winter Performance Tickets

Reserved-seat ticketing for the Orange County Classical Academy winter performance.
Separate from the fine arts site. The fine arts site only links here.

**Status: build steps 1–2 of 8 done (seat map, database and performances).** No holds or payments yet. The seating chart, prices, and nights are placeholders.

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
| Nights: date, grades performing, on sale or not | `config/performances.json` |
| How the curved map is drawn | `GEOMETRY` in `src/lib/layout.ts` |
| Colors | top of `src/app/globals.css` |

Tier rules are checked top to bottom and the first match wins. To price the first two rows of the Left section as Premium, add this above the other rules:

```json
{ "section": "L", "rows": ["A", "B"], "tier": "premium" }
```

To mark a wheelchair space, set `"accessible": true` on that seat in `data/seats.json`. It draws as a square.

## Database

The app reads from Postgres (Supabase) when `DATABASE_URL` is set. Without it,
it reads the config files and shows every seat as open, which is fine for a preview.

Tables are in `supabase/migrations/`. Seats, tiers, and nights come from the config files:

```
npm run db:seed                                  # rebuild supabase/seed.sql after editing config
DATABASE_URL=postgres://... npm run db:apply     # apply new migrations, then the seed
```

Running the seed again updates seats, prices, and nights but never resets seats that are sold or held.
Every table has row level security on with no policies, so Supabase's public API keys can't read
or change anything. Only the app's server, through `DATABASE_URL`, can.

**Not connected to a real Supabase project yet.** When there is one, put its connection
string in `DATABASE_URL` (locally in `.env.local`, and in the host's environment settings) and run `db:apply`.

## Serving from a subpath

Set `BASE_PATH=/tickets` at build time if the app lives under another site's address.

## Build order

1. Seat map ← done
2. Database and performances ← done
3. Seat holds
4. Cart and server-side pricing
5. Stripe test checkout
6. Promo codes
7. Staff area
8. Polish and launch prep
