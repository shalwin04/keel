/**
 * Registers a real Meta ad account so the worker and Keel Bridge can see it.
 * Creates a non-demo workspace owned by the developer sign-in user (user_demo_owner),
 * so it works before Facebook Login for Business is set up.
 *
 *   npm run account:add -- act_123 "Brand name"
 *   (both arguments are optional; defaults to META_AD_ACCOUNT_ID and "Keel Test")
 */
import { createDb, schema } from "@keel/db";

const metaAccountId = process.argv[2] ?? process.env.META_AD_ACCOUNT_ID;
const brandName = process.argv[3] ?? "Keel Test";
if (!metaAccountId?.startsWith("act_")) throw new Error("Pass an ad account id like act_123, or set META_AD_ACCOUNT_ID");

const WS = "ws_keel", OWNER = "user_demo_owner", BRAND = `brand_${metaAccountId}`;
const { db, pool } = createDb();
await db.insert(schema.users).values({ id: OWNER, name: "Demo owner" }).onConflictDoNothing();
await db.insert(schema.workspaces).values({ id: WS, name: "Keel", isDemo: false }).onConflictDoNothing();
await db.insert(schema.memberships).values({ workspaceId: WS, userId: OWNER, role: "owner" }).onConflictDoNothing();
await db.insert(schema.brands).values({ id: BRAND, workspaceId: WS, name: brandName, policy: {} }).onConflictDoNothing();
await db.insert(schema.adAccounts).values({ id: `acct_${metaAccountId}`, brandId: BRAND, metaAccountId, name: brandName }).onConflictDoNothing();
await pool.end();
console.log(`Registered ${metaAccountId} (${brandName}) in workspace "Keel". It will use META_SYSTEM_USER_TOKEN.`);
