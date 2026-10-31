import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env by itself; load it so migrations hit the same database as the app.
try { process.loadEnvFile(".env"); } catch { /* no .env: fall through to the shell's environment */ }
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (check .env)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL },
});
