import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Bind D1 as `DB` in wrangler.toml or configure the same binding in your Cloudflare Workers project before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}
