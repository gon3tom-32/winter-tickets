// Server only: the database connection and data source. The connection string never reaches the browser.
import postgres from "postgres";
import type { Db } from "./db";
import { databaseSource, fileSource, type Source } from "./source";

let db: Db | null | undefined;
let source: Source | undefined;

/** The database, or null when DATABASE_URL isn't set (preview mode from config files). */
export function getDb(): Db | null {
  if (db !== undefined) return db;
  const url = process.env.DATABASE_URL;
  if (!url) return (db = null);
  // prepare: false is needed for Supabase's connection pooler.
  // On Netlify each function instance keeps a small pool and lets idle connections go.
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, onnotice: () => {} });
  const run = (s: postgres.Sql | postgres.TransactionSql) => (text: string, params?: unknown[]) =>
    s.unsafe(text, (params ?? []) as never[]) as unknown as Promise<Record<string, unknown>[]>;
  return (db = {
    query: run(sql),
    transaction: (fn) => sql.begin((tx) => fn(run(tx))) as never,
  });
}

export function getSource(): Source {
  if (source) return source;
  const d = getDb();
  return (source = d ? databaseSource(d.query) : fileSource);
}
