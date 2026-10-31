/**
 * Studio end to end: brief → directions → scenes → layered designs (rendered) → self-check → launch
 * (campaign, ad set, creative with enhancements off, ad — all paused) → baselines locked. Fake models and Graph.
 *   npm run test:e2e:studio
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createRuntime, createStudio, fakeStudioModels } from "@keel/agents";
import { schema } from "@keel/db";
import { renderSvgToPng, saveMedia } from "@keel/meta";

process.env.META_SYSTEM_USER_TOKEN ??= "fake";
const ACCOUNT = "act_9990002";
const posts: { path: string; params: Record<string, string> }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "graph.facebook.com") return realFetch(input, init);
  const path = url.pathname.split("/").slice(2).join("/");
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  if (init?.method === "POST") {
    const params = Object.fromEntries(new URLSearchParams(String(init.body)));
    posts.push({ path, params });
    if (path.endsWith("/campaigns")) return json({ id: "cmp1" });
    if (path.endsWith("/adsets")) return json({ id: "as1" });
    if (path.endsWith("/adimages")) return json({ images: { x: { hash: `h${posts.length}` } } });
    if (path.endsWith("/adcreatives")) return json({ id: `cr${posts.length}` });
    if (path.endsWith("/ads")) return json({ id: `ad${posts.length}` });
  }
  if (path.endsWith("/promote_pages")) return json({ data: [{ id: "page1", name: "Northline Apparel" }] });
  if (path === ACCOUNT) return json({ id: ACCOUNT, name: "Test", account_status: 1, currency: "INR" });
  if (path.startsWith("cr")) return json({ id: path, degrees_of_freedom_spec: { creative_features_spec: { image_touchups: { enroll_status: "OPT_OUT" } } } });
  return new Response(JSON.stringify({ error: { message: `fake graph: ${path}` } }), { status: 400 });
}) as typeof fetch;

const rt = await createRuntime();
const { db } = rt;
await db.insert(schema.users).values({ id: "user_demo_owner", name: "Demo owner" }).onConflictDoNothing();
await db.insert(schema.workspaces).values({ id: "ws_keel", name: "Keel", isDemo: false }).onConflictDoNothing();
await db.insert(schema.brands).values({ id: "brand_studio_e2e", workspaceId: "ws_keel", name: "Northline", policy: {} }).onConflictDoNothing();
await db.insert(schema.adAccounts).values({ id: "acct_studio_e2e", brandId: "brand_studio_e2e", metaAccountId: ACCOUNT, name: "Northline studio (e2e)" }).onConflictDoNothing();

const studio = createStudio({ db, models: fakeStudioModels(), audit: rt.audit, adsFor: rt.adsFor });
const productSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#fff"/><path d="M250 150 Q400 110 550 150 L680 230 L720 520 L640 540 L620 400 L620 700 L180 700 L180 400 L160 540 L80 520 L120 230 Z" fill="#14324A"/><line x1="400" y1="170" x2="400" y2="700" stroke="#E0A23B" stroke-width="10"/></svg>`;
const productRef = await saveMedia(await renderSvgToPng(productSvg, 800, 800), ".png", "uploads");
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const id = await studio.create({
  workspaceId: "ws_keel", brandId: "brand_studio_e2e", accountId: ACCOUNT, name: "Monsoon launch", userId: "user_demo_owner",
  brief: { productName: "Monsoon Jacket", productUrl: "https://northline.test/jacket", productPhotos: [productRef], referenceImages: [], price: "₹3,499", offer: "", audience: "Commuters in Mumbai", countries: ["IN"], ageMin: 22, ageMax: 45, dailyBudget: 500, startDate: day(1), endDate: day(14), notes: "" },
});
for (let i = 0; i < 120; i++) {
  const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, id));
  if (p!.status !== "drafting") break;
  await new Promise((r) => setTimeout(r, 500));
}
const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, id));
assert.equal(p!.status, "ready", `status ${p!.status}: ${p!.error}`);
const designs = await db.select().from(schema.studioDesigns).where(eq(schema.studioDesigns.projectId, id));
assert.equal(designs.length, 9);
assert.ok(designs.every((d) => d.renderRef));
console.log("✓ drafted: 3 directions × 3 sizes rendered", designs.map((d) => d.renderRef!.split("/").pop()).slice(0, 3));

await db.update(schema.studioDesigns).set({ picked: true }).where(eq(schema.studioDesigns.projectId, id));
const launch = await studio.launch(id, "user_demo_owner");
assert.equal(launch.ads.length, 3);
const adset = posts.find((x) => x.path.endsWith("/adsets"))!.params;
assert.equal(adset.daily_budget, "50000");
assert.equal(adset.status, "PAUSED");
const creative = posts.find((x) => x.path.endsWith("/adcreatives"))!.params;
const feats = JSON.parse(creative.degrees_of_freedom_spec!).creative_features_spec;
assert.equal(feats.image_touchups.enroll_status, "OPT_OUT");
assert.equal(JSON.parse(creative.object_story_spec!).link_data.link, "https://northline.test/jacket");
assert.ok(posts.filter((x) => x.path.endsWith("/ads")).every((x) => x.params.status === "PAUSED"));
const baselines = await db.select().from(schema.creativeBaselines).where(eq(schema.creativeBaselines.lockedBy, "user_demo_owner"));
assert.ok(baselines.length >= 3);
console.log("✓ launched paused:", launch.campaignId, launch.adsetId, launch.ads.map((a) => a.adId).join(", "));
await rt.close();
console.log("✓ studio end-to-end passed");
process.exit(0);
