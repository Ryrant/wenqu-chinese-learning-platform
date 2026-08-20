import { drizzle } from "drizzle-orm/d1";
import { getPlatformRuntime } from "../app/lib/platform-runtime";
import * as schema from "./schema";

export function getDb() {
  const database = getPlatformRuntime().database;
  if (!database) {
    throw new Error(
      "Database runtime is unavailable. Configure Cloudflare D1 as `DB` or start the Node runtime before using the database."
    );
  }

  return drizzle(database as unknown as Parameters<typeof drizzle>[0], { schema });
}
