import type { Brief, CompetitorAd, Research } from "@keel/core";
import {
  AD_LIBRARY_EU, AdLibraryAccessError, captureUrl, config, crawlSite, inlineImageHref, libraryUrl, renderSvgToPng, saveMedia, searchAdLibrary,
  type AgentTool, type LibraryAd,
} from "@keel/meta";
import type { StudioModels } from "./models.ts";

const MAX_ADS = Number(process.env.STUDIO_RESEARCH_ADS ?? 12);
const MAX_PAGES = Number(process.env.STUDIO_RESEARCH_PAGES ?? 10);
const STEPS = Number(process.env.STUDIO_RESEARCH_STEPS ?? 8);

const days = (a?: string, b?: string) => (a ? Math.max(1, Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 86_400_000)) : undefined);
const host = (u: string) => { try { const x = new URL(u); return `${x.host.replace(/^www\./, "")}${x.pathname === "/" ? "" : x.pathname}`; } catch { return u; } };

/** Small concurrency limiter so a dozen screenshots and model calls don't all fire at once. */
async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

const AGENT = (steps: number) => `You are Keel's competitive research agent for a Meta (Facebook/Instagram) ad campaign. Find out how competitors in this
category and market advertise and position themselves, so the creative team can make ads that stand out.

Tools:
- search_ad_library: Meta's Ad Library. It may be unavailable on this account; if so, rely on websites. Ads that have run for a long time usually work.
- look_at_ad: view one ad from your search results (a vision model reads the screenshot).
- read_website: open any public web page (a competitor's homepage, a sale, collection or bestseller page, a product page). You get the hero message,
  offers, prices, a visual read of the page, and links you can follow.

Work like a strategist: decide which competitors matter in this market (always include the ones the brief names), read their sites, follow the links
that reveal positioning and offers (sales, bestsellers, the product most like ours), and look at their longest-running ads. Call several tools at once
when they're independent. Use only website addresses you are confident exist, for the right market (for India, e.g. decathlon.in).
Aim for 4-6 competitors; you have ${steps} rounds. Finish with a short plain-text note: what competitors do, what's overused, and where the opening is.`;

type Log = (text: string, kind?: "info" | "decision" | "warn") => Promise<void>;

/**
 * Competitor research as an agent loop: Muse Wonder decides what to search in Meta's Ad Library, which competitor websites to read and which
 * links to follow, and which ads to look at (Muse Spark reads each screenshot). Everything it saw is folded into insights by Wonder.
 * If the loop itself fails, a fixed plan (search the named competitors and category terms, read the suggested sites) runs instead.
 */
export async function gatherResearch(o: { models: StudioModels; brief: Brief; brand: string; log: Log }): Promise<Research> {
  const { models, brief, log } = o;
  const fake = process.env.STUDIO_FAKE_MODELS === "1";
  const found = new Map<string, LibraryAd>();
  const looked = new Map<string, CompetitorAd>();
  const pages = new Map<string, CompetitorAd>();
  const searches: string[] = [];
  let libraryNote: string | undefined;

  // ── tools ────────────────────────────────────────────────────────────────
  async function search(terms: string, countries?: string[]) {
    const markets = countries?.length ? countries.map((c) => c.toUpperCase()).slice(0, 6) : brief.countries;
    if (libraryNote) return { unavailable: libraryNote };
    searches.push(terms);
    let ads: LibraryAd[];
    if (fake) {
      ads = [0, 1].map((k) => ({ id: `fake-${terms}-${k}`.replace(/\W+/g, "-"), page_name: k ? terms : `${terms} store`, ad_creative_bodies: [`${terms}: gear for every season. Up to 40% off.`], ad_delivery_start_time: new Date(Date.now() - (20 + (terms.length + k * 31) % 90) * 86_400_000).toISOString() }));
    } else {
      try {
        ads = await searchAdLibrary({ terms, countries: markets, limit: 15 });
      } catch (err) {
        libraryNote = err instanceof AdLibraryAccessError ? "The Ad Library isn't available on this account. Use read_website instead." : (err as Error).message.slice(0, 200);
        await log(err instanceof AdLibraryAccessError ? "No Ad Library access on this account, so the agent studies competitors' websites instead" : `Ad Library: ${libraryNote}`, "warn");
        return { unavailable: libraryNote };
      }
    }
    for (const a of ads) if (!found.has(a.id)) found.set(a.id, a);
    await log(`Ad Library "${terms}" (${markets.join(", ")}): ${ads.length} ads`);
    const list = ads.map((a) => ({ id: a.id, advertiser: a.page_name, daysRunning: days(a.ad_delivery_start_time, a.ad_delivery_stop_time), headline: a.ad_creative_link_titles?.[0], copy: a.ad_creative_bodies?.[0]?.slice(0, 160) }))
      .sort((x, y) => (y.daysRunning ?? 0) - (x.daysRunning ?? 0));
    return { ads: list, ...(ads.length || markets.some((c) => AD_LIBRARY_EU.includes(c)) ? {} : { hint: `Commercial ads are listed publicly mainly for the EU; try countries ${JSON.stringify(AD_LIBRARY_EU.slice(0, 3))}.` }) };
  }

  async function lookAt(id: string) {
    const a = found.get(id);
    if (!a) return { error: "unknown ad id; use an id from search_ad_library" };
    if (looked.has(id)) return { analysis: looked.get(id)!.analysis };
    if (looked.size >= MAX_ADS) return { error: `already looked at ${MAX_ADS} ads` };
    let snapshotRef: string | undefined;
    if (fake) {
      snapshotRef = await saveMedia(await renderSvgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600"><rect width="500" height="600" fill="#e8ecef"/><rect width="500" height="64" fill="#fff"/><circle cx="34" cy="32" r="18" fill="#1f4e79"/><text x="62" y="38" font-family="Arial" font-size="18" fill="#111">${(a.page_name ?? "").replace(/[<&]/g, "")}</text><rect y="64" width="500" height="420" fill="#2d5f3f"/><path d="M0 484 L160 250 L260 360 L360 200 L500 484Z" fill="#9fb8a5"/><text x="20" y="540" font-family="Arial" font-size="20" fill="#111">Up to 40% off</text></svg>`, 500, 600), ".png", "competitors");
    } else if (a.ad_snapshot_url) {
      try {
        const u = new URL(a.ad_snapshot_url);
        if (!u.searchParams.get("access_token")) u.searchParams.set("access_token", config.graph.adLibraryToken);
        snapshotRef = await saveMedia(await captureUrl(u.toString(), { width: 500, height: 900 }), ".png", "competitors");
      } catch { /* copy-only analysis */ }
    }
    const d = days(a.ad_delivery_start_time, a.ad_delivery_stop_time);
    const ad: CompetitorAd = { id: a.id, source: "ad_library", pageName: a.page_name ?? "Unknown advertiser", body: a.ad_creative_bodies?.[0], title: a.ad_creative_link_titles?.[0],
      startedAt: a.ad_delivery_start_time, stoppedAt: a.ad_delivery_stop_time, daysRunning: d, platforms: a.publisher_platforms, snapshotRef, libraryUrl: fake ? undefined : libraryUrl(a.id) };
    ad.analysis = await models.analyzeAd({ image: snapshotRef ? { dataUrl: await inlineImageHref(snapshotRef) } : undefined, body: ad.body, title: ad.title, pageName: ad.pageName }).catch(() => undefined);
    looked.set(id, ad);
    await log(`Looked at ${ad.pageName}'s ad${d ? ` (${d} days live)` : ""}${ad.analysis?.hook ? `: ${ad.analysis.hook}` : ""}`);
    return { advertiser: ad.pageName, daysRunning: d, analysis: ad.analysis };
  }

  async function read(url: string) {
    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const key = host(target);
    if (pages.has(key)) return { note: "already read", title: pages.get(key)!.title };
    if (pages.size >= MAX_PAGES) return { error: `page budget used (${MAX_PAGES}); finish with what you have` };
    const s = await crawlSite(target, { maxProducts: 2 });
    const offers = [...new Set(s.text.split("\n").map((l) => l.trim()).filter((l) => l.length < 120 && /(\d+\s?%\s?off|sale|free shipping|free delivery|buy \d|flat ₹|save)/i.test(l)))].slice(0, 6);
    const page: CompetitorAd = { id: `site-${pages.size + 1}`, source: "site", pageName: s.siteName || host(s.url), title: s.headings[0], body: [s.description, ...s.headings.slice(1, 6)].filter(Boolean).join(" · ").slice(0, 600), snapshotRef: s.screenshotRef, siteUrl: s.url };
    page.analysis = await models.analyzeAd({ image: { dataUrl: await inlineImageHref(s.screenshotRef) }, body: page.body, title: page.title, pageName: `${page.pageName} (website)` }).catch(() => undefined);
    pages.set(key, page);
    await log(`Read ${host(s.url)}${page.title ? `: "${page.title.slice(0, 80)}"` : ""}${offers[0] ? ` · ${offers[0]}` : ""}`);
    return {
      site: page.pageName, url: s.url, title: s.title, description: s.description, headings: s.headings.slice(0, 10), offers, prices: s.prices.slice(0, 8),
      products: s.products.map((p) => ({ name: p.name, price: p.price })), visual: page.analysis, links: s.links.slice(0, 30).map((l) => ({ text: l.text, url: l.url })),
    };
  }

  const tools: AgentTool[] = [
    { name: "search_ad_library", description: "Search Meta's Ad Library for ads by keyword or advertiser name. Returns ads with how long each has run.",
      parameters: { type: "object", properties: { terms: { type: "string", description: "keyword or brand" }, countries: { type: "array", items: { type: "string" }, description: "ISO country codes; defaults to the campaign's market" } }, required: ["terms"] },
      run: async (a) => JSON.stringify(await search(String(a.terms ?? ""), Array.isArray(a.countries) ? a.countries.map(String) : undefined)) },
    { name: "look_at_ad", description: "Look at one ad from your Ad Library results: a vision model describes its format, hook, visuals, offer and CTA.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: async (a) => JSON.stringify(await lookAt(String(a.id ?? ""))) },
    { name: "read_website", description: "Open a public web page (competitor homepage, sale/collection/product page). Returns its hero message, offers, prices, products, a visual read and links to follow.",
      parameters: { type: "object", properties: { url: { type: "string", description: "a full URL or a domain like decathlon.in" } }, required: ["url"] },
      run: async (a) => JSON.stringify(await read(String(a.url ?? ""))) },
  ];

  // ── the agent ────────────────────────────────────────────────────────────
  const context = [
    `Brand: ${o.brand}. Product: ${brief.productName} (${brief.productUrl})${brief.price ? `, ${brief.price}` : ""}.`,
    `Market: ${brief.countries.join(", ")}. Audience: ${brief.audience || "not stated"}, ages ${brief.ageMin}-${brief.ageMax}.`,
    brief.competitors.length ? `Competitors the brand named: ${brief.competitors.join(", ")}` : "The brand named no competitors; work out who they are.",
    brief.notes && `Notes: ${brief.notes.slice(0, 600)}`,
  ].filter(Boolean).join("\n");
  let notes = "";
  try {
    notes = await models.researchLoop({ system: AGENT(STEPS), text: context, tools, maxSteps: STEPS, onText: (t) => log(t.slice(0, 300), "decision") });
  } catch (err) {
    await log(`Research agent stopped (${(err as Error).message.slice(0, 120)}); following a fixed plan instead`, "warn");
    const plan = await models.researchPlan(brief, o.brand).catch(() => ({ competitors: [], searchTerms: [brief.productName], sites: [] }));
    const isSite = (x: string) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([:/?#]|$)/i.test(x.trim());
    for (const t of [...new Set([...brief.competitors.filter((x) => !isSite(x)), ...plan.competitors.slice(0, 3), ...plan.searchTerms.slice(0, 2)])].slice(0, 6)) await search(t).catch(() => undefined);
    await pool([...new Set([...brief.competitors.filter(isSite), ...plan.sites])].slice(0, 4), 2, (s) => read(s).catch(() => undefined));
  }

  // Make sure the longest-running ads were looked at, even if the agent skipped them.
  const unseen = [...found.values()].filter((a) => !looked.has(a.id)).sort((x, y) => (days(y.ad_delivery_start_time, y.ad_delivery_stop_time) ?? 0) - (days(x.ad_delivery_start_time, x.ad_delivery_stop_time) ?? 0));
  await pool(unseen.slice(0, Math.max(0, Math.min(4, MAX_ADS - looked.size))), 3, (a) => lookAt(a.id).catch(() => undefined));

  const uploads: CompetitorAd[] = brief.competitorShots.map((ref, i) => ({ id: `upload-${i + 1}`, source: "upload", pageName: "Uploaded ad", snapshotRef: ref }));
  await pool(uploads, 3, async (ad) => {
    ad.analysis = await models.analyzeAd({ image: { dataUrl: await inlineImageHref(ad.snapshotRef!) }, pageName: ad.pageName }).catch(() => undefined);
  });

  const ads = [...[...looked.values()].sort((a, b) => (b.daysRunning ?? 0) - (a.daysRunning ?? 0)), ...pages.values(), ...uploads];
  const competitors = [...new Set(ads.filter((a) => a.source !== "upload").map((a) => a.pageName))];
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  await log(`Studied ${n(looked.size, "ad")} and ${n(pages.size, "web page")}${uploads.length ? ` plus ${uploads.length} uploaded` : ""}`, "decision");
  if (!ads.some((a) => a.analysis)) {
    await log("No competitor material to study, so the plan comes from the brief alone", "warn");
    return { searchTerms: searches, competitors, source: "none", note: libraryNote, ads, insights: { summary: notes || "No competitor ads or sites were available, so the directions come from the brief and rulebook alone.", patterns: [], saturated: [], whiteSpace: [], recommendations: [] } };
  }
  const insights = await models.synthesize(brief, o.brand, ads.filter((a) => a.analysis), notes);
  for (const w of insights.whiteSpace.slice(0, 2)) await log(`Opening: ${w}`, "decision");
  const kinds = new Set(ads.map((a) => a.source));
  const source = kinds.size > 1 ? "mixed" : kinds.has("ad_library") ? "ad_library" : kinds.has("site") ? "sites" : "uploads";
  return { searchTerms: searches, competitors, source, note: libraryNote, ads, insights };
}
