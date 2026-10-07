import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

export const pool = new Pool({ connectionString: env.databaseUrl, max: 10 });

export const db = drizzle(pool, { schema, casing: "snake_case" });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Transaction;
