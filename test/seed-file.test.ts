import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildSeedSql } from "@/lib/seed";
import { performances, pricing, seats } from "@/lib/config";

it("supabase/seed.sql is up to date with the config files (run npm run db:seed)", () => {
  const onDisk = readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8");
  expect(onDisk).toBe(buildSeedSql(seats, pricing, performances));
});
