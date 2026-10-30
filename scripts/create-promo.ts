// Creates a promo code from the command line, until the staff area (step 7) exists.
//
//   DATABASE_URL=... npm run promo:create -- CODE percent 50 --seats 2
//   DATABASE_URL=... npm run promo:create -- CODE amount 500 --seats 4 --nights night-1,night-2 --expires 2026-12-20
//
// "amount" is in cents off each covered seat (500 = $5). --reason and --for are optional notes.
import postgres from "postgres";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    seats: { type: "string" },
    nights: { type: "string" },
    expires: { type: "string" },
    reason: { type: "string" },
    for: { type: "string" },
  },
});
const [code, kind, value] = positionals;
if (!process.env.DATABASE_URL || !code || !["percent", "amount"].includes(kind) || !Number(value) || !Number(values.seats)) {
  console.error("Usage: npm run promo:create -- CODE percent|amount VALUE --seats N [--nights a,b] [--expires YYYY-MM-DD] [--reason ...] [--for ...]");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
const nights = values.nights ? values.nights.split(",").map((s) => s.trim()) : null;
await sql.begin(async (tx) => {
  const [row] = await tx`
    insert into promo_codes (code, kind, value, seat_limit, expires_at, performance_ids, issued_to, reason)
    values (${code}, ${kind}, ${Number(value)}, ${Number(values.seats)}, ${values.expires ?? null}, ${nights}, ${values.for ?? null}, ${values.reason ?? null})
    returning id`;
  await tx`insert into audit_log (action, target, details) values ('promo_code.create', ${row.id}, ${tx.json({ code, kind, value: Number(value), seats: Number(values.seats), nights, expires: values.expires ?? null, via: "command line" })})`;
});
console.log(`Created code ${code}.`);
await sql.end();
