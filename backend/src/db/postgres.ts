import { Pool } from "pg";
import { env } from "../config/env";

if (!env.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (error) {
    console.error("PostgreSQL health check failed:", error);
    return false;
  }
}
