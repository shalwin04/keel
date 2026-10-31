/**
 * Applies packages/db/migrations to DATABASE_URL using the same client as the app.
 * (drizzle-kit migrate can exit silently on connection errors; this one prints them.)
 *   npm run db:migrate
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "@keel/db";
import { REPO_ROOT } from "@keel/meta";
import path from "node:path";

const url = new URL(process.env.DATABASE_URL ?? "");
console.log(`Migrating ${url.username}@${url.host}${url.pathname} ...`);
const { db, pool } = createDb();
try {
  await migrate(db, { migrationsFolder: path.join(REPO_ROOT, "packages/db/migrations") });
  const { rows } = await pool.query("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
  console.log(`Done. ${rows[0].n} tables in public.`);
} finally {
  await pool.end();
}
