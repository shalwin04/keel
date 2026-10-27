/** Seeds the Northline demo workspace.  npm run db:seed */
import { createDb, seedDemo } from "@keel/db";

const { db, pool } = createDb();
const r = await seedDemo(db);
await pool.end();
console.log(`Seeded the Northline demo workspace: ${r.ads} ads, ${r.findings} findings, ${r.proposals} to review.`);
