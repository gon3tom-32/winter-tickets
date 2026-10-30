import { writeFileSync } from "node:fs";
import { buildSeedSql } from "../src/lib/seed";
import { performances, pricing, seats } from "../src/lib/config";

writeFileSync(new URL("../supabase/seed.sql", import.meta.url), buildSeedSql(seats, pricing, performances));
console.log(`Wrote supabase/seed.sql: ${seats.length} seats, ${performances.length} performances`);
