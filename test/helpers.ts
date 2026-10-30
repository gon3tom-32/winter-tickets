import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { buildSeedSql } from "@/lib/seed";
import { performances, pricing, seats } from "@/lib/config";
import type { Db } from "@/lib/db";

const dir = new URL("../supabase/migrations/", import.meta.url);
export const migrations = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), "utf8"));
export const seedSql = buildSeedSql(seats, pricing, performances);

/** A fresh in-memory Postgres with every migration and the seed applied. */
export async function freshDb(): Promise<{ pg: PGlite; db: Db }> {
  const pg = new PGlite();
  for (const m of migrations) await pg.exec(m);
  await pg.exec(seedSql);
  const wrap = (t: { query: PGlite["query"] }) => async (text: string, params?: unknown[]) =>
    (await t.query<Record<string, unknown>>(text, params)).rows;
  return { pg, db: { query: wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) } };
}
