/**
 * Autopilot end to end: a real (local) shop website → crawl → brand profile → brief → Studio draft → launch paused →
 * approve "go live" → read results → learnings and moves → approve pause, budget and a new variant. Fake models and Graph.
 *   npm run test:e2e:autopilot
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import type { Move } from "@keel/core";
import { createAutopilot, createRuntime, createStudio, fakeStudioModels, type AutopilotRow } from "@keel/agents";
import { schema } from "@keel/db";
import { renderSvgToPng } from "@keel/meta";

process.env.META_SYSTEM_USER_TOKEN ??= "fake";
process.env.KEEL_ALLOW_LOCAL_SITES = "1";
process.env.STUDIO_FAKE_MODELS = "1";
const ACCOUNT = "act_9990003";

// ── a small shop website ────────────────────────────────────────────────────
const jacket = (fill: string) => renderSvgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#f3f1ed"/><path d="M280 170 Q450 125 620 170 L760 260 L805 590 L715 612 L692 455 L692 790 L208 790 L208 455 L185 612 L95 590 L140 260 Z" fill="${fill}"/><line x1="450" y1="190" x2="450" y2="790" stroke="#E0A23B" stroke-width="12"/></svg>`, 900, 900);
const files: Record<string, { type: string; body: Buffer | string }> = {
  "/img/monsoon.png": { type: "image/png", body: await jacket("#14324A") },
  "/img/trail.png": { type: "image/png", body: await jacket("#2f6b4f") },
  "/logo.svg": { type: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><text x="0" y="44" font-family="Helvetica" font-weight="700" font-size="40" fill="#14324A">NORTHLINE</text></svg>` },
};
const product = (slug: string, name: string, price: number, img: string) => `<!doctype html><html lang="en-IN"><head><title>${name} — Northline</title>
<meta property="og:title" content="${name}"><meta property="og:image" content="/img/${img}.png">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name, image: [`/img/${img}.png`], description: `${name}: seam-sealed, breathable, 380 g.`, offers: { "@type": "Offer", price, priceCurrency: "INR" } })}</script>
</head><body><h1>${name}</h1><img src="/img/${img}.png" width="600" height="600"><p>₹${price.toLocaleString("en-IN")}</p></body></html>`;
files["/products/monsoon-jacket"] = { type: "text/html", body: product("monsoon-jacket", "Monsoon Jacket", 3499, "monsoon") };
files["/products/trail-shell"] = { type: "text/html", body: product("trail-shell", "Trail Shell", 4299, "trail") };
files["/"] = { type: "text/html", body: `<!doctype html><html lang="en-IN"><head><title>Northline | Outerwear for the monsoon city</title>
<meta name="description" content="Weather-ready jackets for commuters. Free shipping across India."><meta property="og:site_name" content="Northline"><meta name="theme-color" content="#14324A">
<style>body{font-family:Georgia,serif;background:#f6f3ee;color:#14324A;margin:0} header{background:#14324A;padding:16px} header a{color:#fff} button{background:#E0A23B;color:#14324A;border:0;padding:12px 20px}</style></head>
<body><header><a href="/"><img src="/logo.svg" alt="Northline logo" width="160"></a> <nav><a href="/products/monsoon-jacket">Jackets</a> <a href="/about">About</a></nav></header>
<h1>Stay dry on the way to work</h1><h2>The Monsoon Jacket</h2><p>Seam-sealed. 380 g. Made for Mumbai rain.</p><button>Shop the jacket</button>
<a href="/products/monsoon-jacket"><img src="/img/monsoon.png" width="300"></a><a href="/products/trail-shell">Trail Shell</a></body></html>` };
const server = createServer((req, res) => {
  const f = files[(req.url ?? "/").split("?")[0]!];
  if (!f) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": f.type }).end(f.body);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const SITE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

// ── a fake Marketing API that also reports results ──────────────────────────
const posts: { path: string; params: Record<string, string> }[] = [];
const results: Record<number, { impressions: number; clicks: number; spend: number; frequency: number }> = {
  0: { impressions: 3200, clicks: 80, spend: 640, frequency: 1.6 }, 1: { impressions: 2600, clicks: 18, spend: 520, frequency: 1.5 }, 2: { impressions: 2900, clicks: 55, spend: 580, frequency: 1.7 },
};
let adOrder: string[] = [];
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
    if (path.endsWith("/ads")) { const id = `ad${posts.length}`; adOrder.push(id); return json({ id }); }
    return json({ success: true }); // status and budget updates
  }
  if (path.endsWith("/promote_pages")) return json({ data: [{ id: "page1", name: "Northline" }] });
  if (path === ACCOUNT) return json({ id: ACCOUNT, name: "Test", account_status: 1, currency: "INR" });
  if (path.startsWith("cr")) return json({ id: path, degrees_of_freedom_spec: { creative_features_spec: { image_touchups: { enroll_status: "OPT_OUT" } } } });
  if (path.endsWith("/insights")) {
    return json({ data: adOrder.slice(0, 3).map((ad_id, i) => { const r = results[i]!; return { ad_id, impressions: String(r.impressions), inline_link_clicks: String(r.clicks), inline_link_click_ctr: String((r.clicks / r.impressions) * 100), cost_per_inline_link_click: String(r.spend / r.clicks), spend: String(r.spend), reach: String(Math.round(r.impressions / r.frequency)), frequency: String(r.frequency) }; }) });
  }
  if (url.searchParams.get("ids")) {
    const paused = new Set(posts.filter((x) => x.params.status === "PAUSED" && !x.path.includes("/")).map((x) => x.path));
    return json(Object.fromEntries(url.searchParams.get("ids")!.split(",").map((id) => [id, { id, effective_status: paused.has(id) ? "PAUSED" : "ACTIVE" }])));
  }
  return new Response(JSON.stringify({ error: { message: `fake graph: ${path}` } }), { status: 400 });
}) as typeof fetch;

const rt = await createRuntime();
const { db } = rt;
await db.insert(schema.users).values({ id: "user_demo_owner", name: "Demo owner" }).onConflictDoNothing();
await db.insert(schema.workspaces).values({ id: "ws_keel", name: "Keel", isDemo: false }).onConflictDoNothing();
await db.insert(schema.brands).values({ id: "brand_autopilot_e2e", workspaceId: "ws_keel", name: "Workspace brand", policy: {} }).onConflictDoNothing();
await db.insert(schema.adAccounts).values({ id: "acct_autopilot_e2e", brandId: "brand_autopilot_e2e", metaAccountId: ACCOUNT, name: "Northline (autopilot e2e)" }).onConflictDoNothing();

const models = fakeStudioModels();
const studio = createStudio({ db, models, audit: rt.audit, adsFor: rt.adsFor });
const autopilot = createAutopilot({ db, models, studio, audit: rt.audit, adsFor: rt.adsFor });
const waitFor = async (id: string, ok: (a: AutopilotRow) => boolean, what: string) => {
  for (let i = 0; i < 240; i++) {
    const a = (await autopilot.get(id))!;
    if (ok(a)) return a;
    if (a.status === "failed") throw new Error(`failed: ${a.error}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
};

// 1. Read the site, research, craft.
const id = await autopilot.start({ workspaceId: "ws_keel", brandId: "brand_autopilot_e2e", accountId: ACCOUNT, url: SITE, userId: "user_demo_owner", dailyBudget: 500, checkEveryHours: 6 });
let ap = await waitFor(id, (a) => a.status === "ready", "the draft");
const site = ap.site as { siteName: string; products: { name: string; price?: string }[]; logoRef?: string; colors: string[] };
assert.equal(site.siteName, "Northline");
assert.ok(site.products.length >= 2, "found both products");
assert.equal(site.products[0]!.price, "3499");
assert.ok(site.logoRef, "saved the logo");
assert.ok(site.colors.includes("#14324a"), "read the brand colour");
const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, ap.projectId!));
const brief = p!.brief as { productName: string; price: string; brand: string; logoRef: string; productPhotos: string[] };
assert.equal(brief.productName, "Monsoon Jacket");
assert.equal(brief.price, "₹3,499");
assert.equal(brief.brand, "Northline");
const designs = await db.select().from(schema.studioDesigns).where(eq(schema.studioDesigns.projectId, p!.id));
assert.ok(designs.every((x) => x.picked), "the agent picked what passed its check");
assert.ok(designs.some((x) => (x.doc as { layers: { role: string }[] }).layers.some((l) => l.role === "logo")), "designs carry the real logo");
console.log(`✓ read ${site.products.length} products from the site; brief "${brief.productName}" ${brief.price}; ${designs.length} designs with the logo`);

// 2. Launch paused, then approve going live.
await autopilot.launch(id, "user_demo_owner", false);
ap = (await autopilot.get(id))!;
assert.equal(ap.status, "live");
const goLive = (ap.moves as Move[]).find((m) => m.kind === "go_live")!;
assert.equal(goLive.status, "pending");
await autopilot.decide(id, goLive.id, "user_demo_owner", true);
ap = await waitFor(id, (a) => (a.moves as Move[]).find((m) => m.id === goLive.id)!.status === "done", "go live");
assert.ok(posts.some((x) => x.path === "cmp1" && x.params.status === "ACTIVE"), "campaign switched on");
assert.ok(posts.some((x) => x.path === "as1" && x.params.status === "ACTIVE"), "ad set switched on");
console.log("✓ launched paused, then switched on after approval");

// 3. Learn from results and propose moves.
await autopilot.check(id);
ap = (await autopilot.get(id))!;
const learnings = ap.learnings as { winner: number | null; summary: string }[];
assert.equal(learnings.at(-1)!.winner, 0, "direction 0 wins");
const moves = (ap.moves as Move[]).filter((m) => m.status === "pending");
const kinds = moves.map((m) => m.kind).sort();
assert.deepEqual(kinds, ["new_variant", "pause_ad", "scale_budget"], `moves: ${kinds.join(", ")}`);
assert.equal(moves.find((m) => m.kind === "pause_ad")!.params.direction, 1, "pauses the weakest");
console.log(`✓ learned: ${learnings.at(-1)!.summary}`);
console.log(`✓ proposed: ${moves.map((m) => m.title).join(" · ")}`);

// 4. Approve them all.
for (const m of moves) await autopilot.decide(id, m.id, "user_demo_owner", true);
ap = await waitFor(id, (a) => (a.moves as Move[]).every((m) => m.status === "done" || m.status === "failed" || m.status === "dismissed"), "the moves");
const failed = (ap.moves as Move[]).filter((m) => m.status === "failed");
assert.equal(failed.length, 0, failed.map((m) => m.result).join("; "));
assert.ok(posts.some((x) => x.path === adOrder[1] && x.params.status === "PAUSED"), "weak ad paused");
assert.ok(posts.some((x) => x.path === "as1" && x.params.daily_budget === "62500"), "budget raised 25%");
const newAd = posts.filter((x) => x.path.endsWith("/ads")).at(-1)!;
assert.equal(newAd.params.status, "ACTIVE", "new variant runs because the campaign is live");
const [p2] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, ap.projectId!));
assert.equal((p2!.directions as unknown[]).length, 4);
assert.equal((p2!.launch as { ads: unknown[] }).ads.length, 4);
console.log("✓ applied: paused the weak ad, raised the budget, added a new variant of the winner");
assert.ok((await autopilot.due(new Date(Date.now() + 7 * 3_600_000))).includes(id), "due again after the interval");

server.close();
await rt.close();
console.log("✓ autopilot end-to-end passed");
process.exit(0);
