// Applies any new migrations, then the seed, to the database in DATABASE_URL.
//   DATABASE_URL=postgres://... npm run db:apply
import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first.");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
const dir = new URL("../supabase/migrations/", import.meta.url);

await sql`create table if not exists app_migrations (name text primary key, applied_at timestamptz not null default now())`;
const done = new Set((await sql`select name from app_migrations`).map((r) => r.name as string));
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(file)) continue;
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(new URL(file, dir), "utf8"));
    await tx`insert into app_migrations (name) values (${file})`;
  });
  console.log(`Applied ${file}`);
}
await sql.unsafe(readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
console.log("Seed loaded.");
await sql.end();
