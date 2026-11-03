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
process.env.KEEL_ALLOW_LOCAL_SITES = "1";
// A competitor's website for the research agent to read.
const { createServer } = await import("node:http");
const rival = createServer((_q, r) => r.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Rival Outdoors</title><meta property="og:site_name" content="Rival Outdoors"><h1>Conquer every summit</h1><p>Monsoon sale: 40% off all rain jackets</p><a href="/sale">Sale</a><script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Rival Shell", review: [{ "@type": "Review", reviewBody: "Soaked through at the seams after twenty minutes of Mumbai rain. Disappointed.", reviewRating: { ratingValue: 2 } }, { "@type": "Review", reviewBody: "Too heavy and sweaty for the train, I only wear it on weekends now.", reviewRating: { ratingValue: 3 } }] })}</script>`));
await new Promise<void>((res) => rival.listen(0, "127.0.0.1", res));
const RIVAL = `http://127.0.0.1:${(rival.address() as { port: number }).port}/`;
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
  brief: { productName: "Monsoon Jacket", productUrl: "https://northline.test/jacket", productPhotos: [productRef], referenceImages: [], price: "₹3,499", offer: "", audience: "Commuters in Mumbai", countries: ["IN"], ageMin: 22, ageMax: 45, dailyBudget: 500, startDate: day(1), endDate: day(14), notes: "", competitors: ["Decathlon", RIVAL], competitorShots: [], objective: "traffic" },
});
for (let i = 0; i < 120; i++) {
  const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, id));
  if (p!.status !== "drafting") break;
  await new Promise((r) => setTimeout(r, 500));
}
const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, id));
assert.equal(p!.status, "ready", `status ${p!.status}: ${p!.error}`);
const research = p!.research as { ads: unknown[]; insights: { whiteSpace: string[] } };
assert.ok(research.ads.length >= 3, "research found competitor ads");
assert.ok((research.ads as { source: string; pageName: string }[]).some((a) => a.source === "site" && a.pageName === "Rival Outdoors"), "the agent read the competitor's website");
assert.ok(research.insights.whiteSpace.length, "insights name open space");
assert.ok((p!.log as unknown[]).length >= 5, "the agent logged its decisions");
const dirs = p!.directions as { frames?: (string | null)[]; storyboard: { reel: unknown[] } }[];
assert.equal(dirs[0]!.frames?.filter(Boolean).length, dirs[0]!.storyboard.reel.length, "storyboard frames drawn for the lead direction");
console.log(`✓ researched ${research.ads.length} ads; ${(p!.log as unknown[]).length} agent log entries; ${dirs[0]!.frames!.length} storyboard frames`);
const voice = (p!.research as { voice?: { quotes: unknown[]; personas: unknown[] } }).voice;
assert.ok(voice && voice.quotes.length >= 3 && voice.personas.length, "the agent read customer reviews and Reddit and built personas");
console.log(`✓ customer voice: ${voice!.quotes.length} comments, ${voice!.personas.length} persona(s)`);
const designs = await db.select().from(schema.studioDesigns).where(eq(schema.studioDesigns.projectId, id));
assert.equal(designs.length, 9);
assert.ok(designs.every((d) => d.renderRef));
console.log("✓ drafted: 3 directions × 3 sizes rendered", designs.map((d) => d.renderRef!.split("/").pop()).slice(0, 3));

// Concept board: many formats, pre-scored; add the two recommended ones to the campaign.
const n = await studio.makeConcepts(id);
const [withBoard] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, id));
const board = withBoard!.concepts as { status: string; items: { id: string; format: string; score?: { overall: number }; recommended?: boolean; copy?: { quote: string; author: string } }[] };
assert.equal(board.status, "ready");
assert.ok(n >= 5 && new Set(board.items.map((c) => c.format)).size >= 5, `concepts across formats: ${board.items.map((c) => c.format).join(", ")}`);
assert.ok(board.items.every((c) => c.score), "every concept pre-scored by Spark");
// The only reviews found were of a competitor, so no testimonial may show them as ours.
assert.ok(!board.items.some((c) => c.format === "testimonial"), "never presents a competitor's review as our testimonial");
const recommended = board.items.filter((c) => c.recommended);
assert.equal(recommended.length, 3);
const added = await studio.addConcepts(id, recommended.slice(0, 2).map((c) => c.id), "user_demo_owner");
assert.equal(added.length, 2);
console.log(`✓ concept board: ${board.items.length} concepts (${[...new Set(board.items.map((c) => c.format))].join(", ")}); added 2`);
await studio.makeConcepts(id, { remixOf: (p!.research as { ads: { id: string; source: string }[] }).ads.find((a) => a.source === "ad_library")!.id });
const [withRemix] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, id));
assert.ok((withRemix!.concepts as { items: { remixOf?: unknown }[] }).items.some((c) => c.remixOf), "remix of a competitor ad");
console.log("✓ remixed a competitor ad's structure");

await db.update(schema.studioDesigns).set({ picked: true }).where(eq(schema.studioDesigns.projectId, id));
const launch = await studio.launch(id, "user_demo_owner");
assert.equal(launch.ads.length, 5);
const adset = posts.find((x) => x.path.endsWith("/adsets"))!.params;
assert.equal(adset.daily_budget, "50000");
assert.equal(adset.status, "PAUSED");
const creative = posts.find((x) => x.path.endsWith("/adcreatives"))!.params;
const feats = JSON.parse(creative.degrees_of_freedom_spec!).creative_features_spec;
assert.equal(feats.image_touchups.enroll_status, "OPT_OUT");
assert.equal(JSON.parse(creative.object_story_spec!).link_data.link, "https://northline.test/jacket");
assert.ok(posts.filter((x) => x.path.endsWith("/ads")).every((x) => x.params.status === "PAUSED"));
const baselines = await db.select().from(schema.creativeBaselines).where(eq(schema.creativeBaselines.lockedBy, "user_demo_owner"));
assert.ok(baselines.length >= 5);
console.log("✓ launched paused:", launch.campaignId, launch.adsetId, launch.ads.map((a) => a.adId).join(", "));
rival.close();
await rt.close();
console.log("✓ studio end-to-end passed");
process.exit(0);
