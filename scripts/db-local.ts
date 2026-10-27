/**
 * Local Postgres without Docker: downloads a real Postgres build for this machine
 * and runs it from .data/pg. Matches DATABASE_URL in .env.example.
 *   npm run db:local
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const dataDir = ".data/pg";
const fresh = !existsSync(dataDir);
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "keel", password: "keel", port: 5432, persistent: true });

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("keel");
console.log("Postgres running on postgres://keel:keel@localhost:5432/keel (Ctrl+C to stop)");

const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
