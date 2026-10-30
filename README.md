# Winter Performance Tickets

Reserved-seat ticketing for the Orange County Classical Academy winter performance.
Separate from the fine arts site. The fine arts site only links here.

**Status: build steps 1–7 of 8 done (seat map, database, seat holds, cart and pricing, checkout, promo codes, staff area).** Payments run in Stripe test mode once keys are added. The seating chart, prices, and nights are placeholders.

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

**Supabase project:** `winter-tickets` (ref `wvykjbwyddldmyaqfyfo`, region us-west-1). All migrations
and the seed are loaded, and the expired-hold cleanup runs every 5 minutes there (pg_cron).

To connect the app, get the connection string from the Supabase dashboard: open the project, press
**Connect**, choose **Transaction pooler**, and copy the URI. Put your database password in it (reset it
under Project Settings > Database if you don't have it). Use that as `DATABASE_URL` locally in
`.env.local` and in the hosting site's environment settings. Never commit it.

Future migrations: `DATABASE_URL=... npm run db:apply` applies only the new ones (it tracks them in `app_migrations`).

## Seat holds

When a buyer picks a seat, the server holds it for them (`holdMinutes` in `config/pricing.json`, 10 by default).

- Claiming a seat is one locked database update, so two buyers can never hold the same seat.
  The second one is told someone else is choosing it.
- All of a buyer's seats share one countdown. It starts with the first seat; adding seats doesn't extend it.
- The seats-per-order cap counts seats on every night.
- Each browser is identified by a private `hold_token` cookie. A reload keeps the buyer's seats.
- The map refreshes every 15 seconds and when the buyer returns to the tab.
- An expired hold counts as open right away. The cleanup below tidies the table; it's already
  scheduled on the winter-tickets Supabase project. For a new project, enable `pg_cron`
  (Database > Extensions), then run in the SQL editor:

  ```sql
  select cron.schedule('release-expired-holds', '*/5 * * * *', 'select public.release_expired_holds()');
  ```

In preview mode (no database) there are no holds; choices stay in the browser.

## Cart and pricing

The cart (`/cart`) lists every seat the buyer holds, grouped by night. For each night the buyer
must pick at least one grade they're supporting, from that night's grades.

Prices are always worked out on the server (`src/lib/pricing.ts`), in this order:

1. Each seat at its tier price, in cents (read from the database, so a price change shows up at once).
2. Seats on 2 or more nights in one order: `multiNightDiscountPercent` off every seat. A third night adds nothing.
3. A promo code's discount on the same seats.
4. Whichever discount is better for the buyer. They never combine.
5. Round once, at the end. Per-seat prices are split so they add up exactly to the total.
6. A total between 1¢ and `minChargeCents` (Stripe's 50¢ minimum) blocks checkout.

## Checkout and payments

1. In the cart the buyer enters name and email and presses **Continue to payment**.
2. The server re-prices the cart, creates a pending order, and keeps the seats held for
   `checkoutMinutes` (30, Stripe's minimum) while they pay.
3. A $0 order is confirmed right away. Otherwise the buyer goes to Stripe's payment page.
4. Seats are marked sold **only** when Stripe's webhook confirms payment, never when the buyer returns.
   Then the confirmation email goes out with a QR code, and the order page shows the tickets.
5. If payment arrives but a seat is gone (the hold ran out and someone else bought it), nothing is
   sold, the payment is refunded automatically, the buyer is emailed, and the order is flagged for staff.
6. If the payment page expires, the order is cancelled and the seats open up.

### Promo codes

- Each code covers a set number of seats in total, as a running balance across orders.
  A 2-seat code covers 2 seats on one night, or 1 seat on each of 2 nights.
- **Percent** codes take that percent off each covered seat; 100% makes them free.
  **Dollar** codes take that amount off each covered seat, never below $0.
- If an order has more eligible seats than the code has left, it covers the most expensive ones.
- A code can be limited to some nights, can expire, and can be turned off. Codes are matched
  regardless of upper or lower case, and are never deleted.
- The code and the multi-night discount never combine: the buyer gets whichever is bigger, and the
  cart says so. A code is only used up if it's the one applied.
- The code's seats are reserved when checkout starts, so two buyers can't both use the last one.
  They go back to the code if the order is cancelled, its payment page expires, or it's refunded.

**Assumptions to confirm:** dollar codes are per seat (not per order), and the balance runs across
orders (from the spec's open items).

Staff create codes in the staff area (`/staff/codes`). The command line also works. Every code
created is written to the audit log.

```
DATABASE_URL=... npm run promo:create -- WINTER percent 50 --seats 2
DATABASE_URL=... npm run promo:create -- TEACHER amount 500 --seats 4 --nights night-1,night-2 --expires 2026-12-20 --for "[Name]" --reason "[Why]"
```

### Turning on Stripe (test mode)

1. Create a free Stripe account and stay in **Test mode**.
2. Developers > API keys: copy the **Secret key** (`sk_test_...`) into `STRIPE_SECRET_KEY`.
3. Developers > Webhooks > Add endpoint:
   - URL: `https://<your site>/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.expired`,
     `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
   - Copy its **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
4. Set `SITE_URL` to the site's address.
5. Pay with Stripe's test card `4242 4242 4242 4242`, any future date, any CVC.

To test on your own computer, the Stripe CLI can forward webhooks:
`stripe listen --forward-to localhost:3000/api/stripe/webhook` (it prints the `whsec_...` to use).

**Going live later** means swapping in the school's live keys, adding the same webhook in live
mode, and setting `SITE_URL`. No code changes.

### Testing without Stripe

Set `FAKE_PAYMENTS=1` (and no `STRIPE_SECRET_KEY`). Checkout then goes to a stand-in payment
page at `/dev/pay` with **Pay (test)**, **Back to cart**, and **Let the page expire** buttons.
It does nothing once a Stripe key is set.

### Email

Set `RESEND_API_KEY` and `EMAIL_FROM` to send confirmation emails through Resend. The sending
domain has to be verified in Resend first. Without a key, emails are printed to the server log.

## Staff area (`/staff`)

**Signing in.** Staff enter their email and get a one-time sign-in link (expires in 15 minutes,
works once, at most one per minute). The link opens a page with a **Sign in** button rather than
signing in on its own, because some email programs open links to check them. Sessions last 12 hours.
Links and session cookies are stored only as hashes. Without `RESEND_API_KEY`, the link is printed
to the server log, which is how to sign in while testing.

This doesn't use Supabase Auth. It works on any Postgres and only needs the same email service
as the tickets.

**First admin.** Add the first admin from the command line; after that, admins add staff on the Staff page:

```
DATABASE_URL=... npm run staff:add -- teacher@school.org --admin
```

**What's there:**

| Page | What it does |
|---|---|
| Nights | Each night: seats taken, in checkout, and open |
| Seat ledger (per night) | Paid, discounted with a code, free with a code, comped, held in checkout, available. Always adds up to the seat count, with a warning if not. Seats by grade supported, and a list of who's coming |
| Comp seats | Pick seats on the map, enter who they're for, the grade, and why |
| Promo codes | Create codes, turn them off, raise limits |
| Flagged orders | Orders a person should look at (such as automatic refunds), with a note when handled |
| Audit log | Every comp, code change, staff change, and sign-in. Can't be edited or deleted |
| Staff (admins) | Add staff, change roles, turn accounts off (which also signs them out) |

**Roles:**

| Action | Staff | Admin |
|---|---|---|
| Comp seats | Yes | Yes |
| Create percent or dollar codes | Yes | Yes |
| Create codes that make seats free (100%, or dollars off the full price) | No | Yes |
| Raise a code's seat limit | No | Yes |
| Turn codes off | Yes | Yes |
| Undo a comp | No | Yes |
| Manage staff | No | Yes |

## Tests

```
npm test
```

Database tests run on an in-memory Postgres. The many-buyers-at-once test needs a real server and
**wipes the database it's given**, so only point it at an empty throwaway one:

```
TEST_DATABASE_URL=postgres://localhost/tickets_test npm test
```

## Deploying on Netlify

`netlify.toml` has the build settings. Netlify detects the Next.js app and runs its server parts as functions.

1. In Netlify: **Add new project → Import an existing project → GitHub**, and pick `gon3tom-32/winter-tickets`.
   The build settings fill in from `netlify.toml`. Press **Deploy**.
2. **Project configuration → Change project name**, for example `oc-winter-tickets`, so the address is
   `https://oc-winter-tickets.netlify.app`.
3. **Project configuration → Environment variables**, add (mark each as containing a secret):
   - `DATABASE_URL`: the Supabase transaction pooler connection string (see Database above)
   - later: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`
   - `SITE_URL` is optional. Netlify's own address is used automatically. Set it once the site has a custom domain.
4. **Deploys → Trigger deploy** so the new settings take effect.
5. The Stripe webhook address is `https://<your site>/api/stripe/webhook`.

Every push to `main` redeploys automatically.

## Serving from a subpath

Set `BASE_PATH=/tickets` at build time if the app lives under another site's address.

## Build order

1. Seat map ← done
2. Database and performances ← done
3. Seat holds ← done
4. Cart and server-side pricing ← done
5. Stripe test checkout ← done
6. Promo codes ← done
7. Staff area ← done
8. Polish and launch prep
