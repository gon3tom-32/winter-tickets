// Adds a staff member from the command line. Use it once to create the first admin;
// after that, admins add staff from the staff area.
//   DATABASE_URL=... npm run staff:add -- teacher@school.org --admin
import postgres from "postgres";
import { parseArgs } from "node:util";
import { addStaff } from "../src/lib/staff/users";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { admin: { type: "boolean" } } });
const email = positionals[0];
if (!process.env.DATABASE_URL || !email) {
  console.error("Usage: npm run staff:add -- EMAIL [--admin]");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
const run = (s: postgres.Sql | postgres.TransactionSql) => (text: string, params?: unknown[]) =>
  s.unsafe(text, (params ?? []) as never[]) as unknown as Promise<Record<string, unknown>[]>;
const result = await addStaff(
  { query: run(sql), transaction: (fn) => sql.begin((tx) => fn(run(tx))) as never },
  null,
  email,
  values.admin ? "admin" : "staff",
);
console.log(result === "ok" ? `Added ${email} as ${values.admin ? "admin" : "staff"}.` : `Not added: ${result}`);
await sql.end();
