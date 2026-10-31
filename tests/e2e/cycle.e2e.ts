/**
 * End-to-end check of the real runtime (Postgres, LangGraph checkpoints, actions, verify, learning)
 * against an in-memory Marketing API and scripted model replies. No network.
 *
 *   DATABASE_URL=postgres://… npm run test:e2e
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import { and, eq } from "drizzle-orm";
import { createRuntime } from "@keel/agents";
import { schema } from "@keel/db";
import { REPO_ROOT } from "@keel/meta";

const ACCOUNT = "act_9990001";
const AD = "9990001001";
process.env.META_SYSTEM_USER_TOKEN ??= "fake";
process.env.META_API_KEY ??= "fake";
process.env.VARIANT_SOURCE = "fixtures";
process.env.SAM_DISABLED = "1";
process.env.INVESTIGATOR_DISABLED = "1";
delete process.env.OPENWEIGHT_API_KEY;

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// ── fake Meta ────────────────────────────────────────────────────────────────
const creatives: Record<string, Record<string, unknown>> = {};
const spec = (on: string[], off: string[]) => ({ creative_features_spec: Object.fromEntries([...on.map((k) => [k, { enroll_status: "OPT_IN" }]), ...off.map((k) => [k, { enroll_status: "OPT_OUT" }])]) });
const story = { page_id: "p1", link_data: { link: "https://northline.test", message: "Fleece that keeps up.", picture: "https://cdn.test/hero.png" } };
creatives.c1 = { id: "c1", name: "Hero", object_story_spec: story, degrees_of_freedom_spec: spec(["text_optimizations"], ["image_touchups", "image_background_gen"]) };
const ad = { id: AD, name: "Fleece hero — feed", status: "ACTIVE", effective_status: "ACTIVE", creative: { id: "c1" } };
let nextCreative = 100;
let screenScore = 0.1;
const graphWrites: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "cdn.test") return new Response(PNG, { headers: { "content-type": "image/png" } });
  if (url.hostname === "graph.facebook.com") {
    const path = url.pathname.split("/").slice(2).join("/");
    if (init?.method === "POST") {
      const p = Object.fromEntries(new URLSearchParams(String(init.body)));
      graphWrites.push(path);
      if (path === `${ACCOUNT}/adcreatives`) {
        const id = `c${++nextCreative}`;
        creatives[id] = { id, name: p.name, object_story_spec: JSON.parse(p.object_story_spec!), degrees_of_freedom_spec: JSON.parse(p.degrees_of_freedom_spec!) };
        return json({ id });
      }
      if (path === AD) {
        if (p.creative) ad.creative = { id: JSON.parse(p.creative).creative_id };
        if (p.status) ad.status = ad.effective_status = p.status;
        return json({ success: true });
      }
    }
    if (path === `${ACCOUNT}/ads`) return json({ data: [ad] });
    if (path === AD) return json(ad);
    if (path.endsWith("/previews")) return json({ data: [] });
    if (creatives[path]) return json(creatives[path]);
    return json({ error: { message: `fake graph: no ${path}` } }, 400);
  }
  if (url.pathname.endsWith("/chat/completions")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { content: unknown }[] };
    const text = JSON.stringify(body.messages);
    const variantId = /variantId: ([^\\\n"]+)/.exec(text)?.[1] ?? "";
    const content = text.includes("first-pass ad screener")
      ? { variantId, score: screenScore, suspected: screenScore > 0.5 ? ["PERSON_MISMATCH"] : [], note: screenScore > 0.5 ? "different model" : "same ad" }
      : { findings: [{ code: "PERSON_MISMATCH", summary: "A different model replaced the approved one.", evidence: ["face and hair differ"], regionLabels: ["person"], confidence: 0.92 }] };
    return json({ id: "x", object: "chat.completion", created: 0, model: "fake", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }], usage: { prompt_tokens: 1200, completion_tokens: 80 } });
  }
  return realFetch(input, init);
}) as typeof fetch;

// ── run ──────────────────────────────────────────────────────────────────────
const rt = await createRuntime();
const { db } = rt;
const step = (s: string) => console.log(`\n▸ ${s}`);

// Clean slate for this fake account; register it to the dev owner in a real (non-demo) workspace.
for (const t of [schema.findings, schema.snapshots, schema.cycles] as const) await db.delete(t).where(eq(t.accountId, ACCOUNT));
await db.delete(schema.approvals).where(eq(schema.approvals.decidedBy, "user_demo_owner"));
await db.delete(schema.proposals).where(eq(schema.proposals.accountId, ACCOUNT));
await db.delete(schema.creativeBaselines).where(eq(schema.creativeBaselines.adId, AD));
await db.insert(schema.users).values({ id: "user_demo_owner", name: "Demo owner" }).onConflictDoNothing();
await db.insert(schema.workspaces).values({ id: "ws_keel", name: "Keel", isDemo: false }).onConflictDoNothing();
await db.insert(schema.memberships).values({ workspaceId: "ws_keel", userId: "user_demo_owner", role: "owner" }).onConflictDoNothing();
await db.insert(schema.brands).values({ id: "brand_northline_e2e", workspaceId: "ws_keel", name: "Northline Apparel", policy: {} }).onConflictDoNothing();
await db.insert(schema.adAccounts).values({ id: "acct_e2e", brandId: "brand_northline_e2e", metaAccountId: ACCOUNT, name: "Northline (e2e)" }).onConflictDoNothing();
const fixtureDir = join(REPO_ROOT, "eval/fixtures", AD);
await mkdir(fixtureDir, { recursive: true });
await writeFile(join(fixtureDir, "variant-feed.png"), PNG);

const pending = async () => db.select().from(schema.proposals).where(and(eq(schema.proposals.accountId, ACCOUNT), eq(schema.proposals.status, "pending")));
const decide = async (decision: "approve" | "reject") => {
  const [p] = await pending();
  assert.ok(p, "expected a pending proposal");
  await db.update(schema.proposals).set({ status: "deciding" }).where(eq(schema.proposals.id, p.id));
  await db.insert(schema.approvals).values({ id: crypto.randomUUID(), proposalId: p.id, channel: "web", decidedBy: "user_demo_owner", decision });
  await rt.graph.invoke(new Command({ resume: { proposalId: p.id, decision, decidedBy: "user_demo_owner", channel: "web" } }), { configurable: { thread_id: p.cycleId } });
  return p;
};
const status = async (id: string) => (await db.select().from(schema.proposals).where(eq(schema.proposals.id, id)))[0]!;

step("1. first sight locks the baseline; a clean variant raises nothing");
let cycle = await rt.runCycle(ACCOUNT);
assert.equal((await pending()).length, 0);
const [base] = await db.select().from(schema.creativeBaselines).where(eq(schema.creativeBaselines.adId, AD));
assert.equal((base!.featuresSpec as Record<string, string>).image_touchups, "OPT_OUT");
console.log("  baseline locked", base!.featuresSpec);

step("2. someone turns Visual touch-ups on in Ads Manager (new creative id)");
creatives.c2 = { ...creatives.c1, id: "c2", degrees_of_freedom_spec: spec(["text_optimizations", "image_touchups"], ["image_background_gen"]) };
ad.creative = { id: "c2" };
cycle = await rt.runCycle(ACCOUNT);
let [p] = await pending();
assert.equal(p?.action, "RELOCK_SETTING");
assert.equal((await db.select().from(schema.cycles).where(eq(schema.cycles.id, cycle)))[0]!.status, "awaiting_approval");
console.log("  proposal:", p!.reason);

step("3. approve → Keel clones the creative with it off, swaps it in, verifies with a read-back");
const approved = await decide("approve");
const after = await status(approved.id);
assert.equal(after.status, "executed", JSON.stringify(after.outcome));
assert.notEqual(ad.creative.id, "c2");
assert.equal((creatives[ad.creative.id]!.degrees_of_freedom_spec as ReturnType<typeof spec>).creative_features_spec.image_touchups!.enroll_status, "OPT_OUT");
console.log("  outcome:", JSON.stringify(after.outcome));

step("4. next check is clean");
await rt.runCycle(ACCOUNT);
assert.equal((await pending()).length, 0);

step("5. drift again, and this time the owner keeps it → baseline accepts it, never asked again");
creatives.c3 = { ...creatives.c1, id: "c3", degrees_of_freedom_spec: spec(["text_optimizations", "image_background_gen"], ["image_touchups"]) };
ad.creative = { id: "c3" };
await rt.runCycle(ACCOUNT);
const rejected = await decide("reject");
assert.equal((await status(rejected.id)).status, "rejected");
await rt.runCycle(ACCOUNT);
assert.equal((await pending()).length, 0, "a kept setting must not be raised again");

step("6. a served variant with a different model → inspect finding → revert, approved and verified");
screenScore = 0.9;
await rt.runCycle(ACCOUNT);
[p] = await pending();
assert.ok(p, "expected a visual finding");
assert.equal(p.action, "REVERT_CREATIVE");
const reverted = await decide("approve");
const r = await status(reverted.id);
assert.equal(r.status, "executed", JSON.stringify(r.outcome));
const finalSpec = (creatives[ad.creative.id]!.degrees_of_freedom_spec as ReturnType<typeof spec>).creative_features_spec;
assert.ok(Object.values(finalSpec).every((v) => (v as { enroll_status: string }).enroll_status === "OPT_OUT"));

step("7. the audit chain is intact");
const { verifyChain } = await import("@keel/db");
const log = await db.select().from(schema.auditLog).orderBy(schema.auditLog.seq);
assert.equal(verifyChain(log), -1);
console.log(`  ${log.length} entries, Graph writes: ${graphWrites.join(", ")}`);

await rt.close();
console.log("\n✓ end-to-end cycle passed");
