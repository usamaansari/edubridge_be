import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing or empty. Add it to .env, then run the drizzle command again.");
}

/** Avoid hanging forever when the host/port is wrong or Postgres is down (libpq / node-pg). */
function withConnectTimeout(url: string, seconds = 10): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connect_timeout")) {
      u.searchParams.set("connect_timeout", String(seconds));
    }
    return u.href;
  } catch {
    return url;
  }
}

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema/index.ts",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url: withConnectTimeout(databaseUrl),
  },
  // Default is schema "drizzle", which needs CREATE SCHEMA. "public" avoids that.
  migrations: {
    schema: "public",
  },
  strict: true,
  verbose: true,
});
