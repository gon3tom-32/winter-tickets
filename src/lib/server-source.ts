// Server only: picks the data source. The database connection string never reaches the browser.
import postgres from "postgres";
import { databaseSource, fileSource, type Source } from "./source";

let cached: Source | undefined;

export function getSource(): Source {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) return (cached = fileSource);
  // prepare: false is needed for Supabase's connection pooler.
  const sql = postgres(url, { prepare: false, max: 5 });
  return (cached = databaseSource((text, params) => sql.unsafe(text, (params ?? []) as never[]) as never));
}
