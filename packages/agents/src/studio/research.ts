import type { Brief, CompetitorAd, Research } from "@keel/core";
import { AD_LIBRARY_EU, AdLibraryAccessError, config, crawlSite, captureUrl, inlineImageHref, libraryUrl, renderSvgToPng, saveMedia, searchAdLibrary, type LibraryAd } from "@keel/meta";
import type { StudioModels } from "./models.ts";

const MAX_ADS = Number(process.env.STUDIO_RESEARCH_ADS ?? 12);
const MAX_SITES = 4;

const days = (a?: string, b?: string) => (a ? Math.max(1, Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 86_400_000)) : undefined);

/** Small concurrency limiter so a dozen screenshots and model calls don't all fire at once. */
async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

/**
 * Competitor research: the agent decides what to search, pulls ads from Meta's Ad Library (falling back to EU
 * listings, where commercial ads are public), adds any screenshots the person uploaded, keeps the longest-running
 * ads (the ones that likely work), reads each with Muse Spark, and has Muse Wonder turn it all into insights.
 */
export async function gatherResearch(o: { models: StudioModels; brief: Brief; brand: string; log: (text: string, kind?: "info" | "decision" | "warn") => Promise<void> }): Promise<Research> {
  const { models, brief, log } = o;
  const fake = process.env.STUDIO_FAKE_MODELS === "1";
  const plan = await models.researchPlan(brief, o.brand);
  const terms = [...new Set([...brief.competitors, ...plan.competitors.slice(0, 4), ...plan.searchTerms.slice(0, 3)])].slice(0, 7);
  await log(`Searching for: ${terms.join(", ")}`, "decision");

  const found = new Map<string, LibraryAd>();
  let note: string | undefined;
  if (fake) {
    for (const [i, t] of terms.entries()) found.set(`fake${i}`, { id: `fake${i}`, page_name: t, ad_creative_bodies: [`${t}: gear for every season. Up to 40% off.`], ad_delivery_start_time: new Date(Date.now() - (20 + i * 17) * 86_400_000).toISOString() });
  } else {
    const markets = [brief.countries, AD_LIBRARY_EU];
    for (const countries of markets) {
      for (const t of terms) {
        try {
          for (const ad of await searchAdLibrary({ terms: t, countries, limit: 15 })) if (!found.has(ad.id)) found.set(ad.id, ad);
        } catch (err) {
          note = (err as Error).message;
          await log(err instanceof AdLibraryAccessError ? "No Ad Library access on this token, so studying competitors' websites instead" : `Ad Library: ${note.slice(0, 160)}`, "warn");
          break;
        }
      }
      if (found.size >= MAX_ADS || note) break;
      if (countries === brief.countries) await log(`Only ${found.size} ads listed for ${brief.countries.join(", ")} (the Ad Library shows commercial ads publicly only for the EU) — widening to EU listings`, "info");
    }
  }

  // Longest-running first: an ad that has stayed live for months is usually one that performs.
  const top = [...found.values()]
    .map((a) => ({ a, d: days(a.ad_delivery_start_time, a.ad_delivery_stop_time) ?? 0 }))
    .sort((x, y) => y.d - x.d)
    .slice(0, MAX_ADS);
  if (top.length) await log(`Kept the ${top.length} longest-running of ${found.size} ads (${top[0]!.d} to ${top.at(-1)!.d} days live)`, "decision");

  const ads: CompetitorAd[] = await pool(top, 3, async ({ a, d }) => {
    let snapshotRef: string | undefined;
    if (fake) {
      snapshotRef = await saveMedia(await renderSvgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600"><rect width="500" height="600" fill="#e8ecef"/><rect x="0" y="0" width="500" height="64" fill="#fff"/><circle cx="34" cy="32" r="18" fill="#1f4e79"/><text x="62" y="38" font-family="Arial" font-size="18" fill="#111">${a.page_name}</text><rect x="0" y="64" width="500" height="420" fill="#2d5f3f"/><path d="M0 484 L160 250 L260 360 L360 200 L500 484Z" fill="#9fb8a5"/><text x="20" y="540" font-family="Arial" font-size="20" fill="#111">Up to 40% off</text></svg>`, 500, 600), ".png", "competitors");
    } else if (a.ad_snapshot_url) {
      try {
        const u = new URL(a.ad_snapshot_url);
        if (!u.searchParams.get("access_token")) u.searchParams.set("access_token", config.graph.adLibraryToken);
        snapshotRef = await saveMedia(await captureUrl(u.toString(), { width: 500, height: 900 }), ".png", "competitors");
      } catch { /* copy-only analysis */ }
    }
    return { id: a.id, source: "ad_library" as const, pageName: a.page_name ?? "Unknown advertiser", body: a.ad_creative_bodies?.[0], title: a.ad_creative_link_titles?.[0],
      startedAt: a.ad_delivery_start_time, stoppedAt: a.ad_delivery_stop_time, daysRunning: d || undefined, platforms: a.publisher_platforms, snapshotRef, libraryUrl: fake ? undefined : libraryUrl(a.id) };
  });
  for (const [i, ref] of brief.competitorShots.entries()) ads.push({ id: `upload-${i + 1}`, source: "upload", pageName: "Uploaded ad", snapshotRef: ref });

  // Without Ad Library ads, the agent reads competitors' own websites: their hero message, offer and look.
  if (!fake && !ads.some((a) => a.source === "ad_library")) {
    const domain = (x: string) => { const m = x.trim().match(/^(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/?#].*)?$/i); return m ? m[1]!.toLowerCase() : undefined; };
    const sites = [...new Set([...brief.competitors, ...plan.sites].map(domain).filter((x): x is string => !!x))].slice(0, MAX_SITES);
    if (sites.length) await log(`Reading competitor websites: ${sites.join(", ")}`, "decision");
    const read = await pool(sites, 2, async (host, i) => {
      try {
        const s = await crawlSite(`https://${host}`, { maxProducts: 0 });
        return { id: `site-${i + 1}`, source: "site" as const, pageName: s.siteName || host, title: s.headings[0], body: [s.description, ...s.headings.slice(1, 6)].filter(Boolean).join(" · ").slice(0, 600), snapshotRef: s.screenshotRef, siteUrl: s.url } satisfies CompetitorAd;
      } catch (err) {
        await log(`Couldn't read ${host} (${(err as Error).message.slice(0, 80)})`, "warn");
        return undefined;
      }
    });
    ads.push(...read.filter((x): x is NonNullable<typeof x> => !!x));
  }

  if (!ads.length) {
    await log("No competitor ads to study — planning from the brief alone", "warn");
    return { searchTerms: terms, competitors: plan.competitors, source: "none", note, ads, insights: { summary: "No competitor ads were available, so the directions come from the brief and rulebook alone.", patterns: [], saturated: [], whiteSpace: [], recommendations: [] } };
  }

  await pool(ads, 4, async (ad) => {
    try {
      ad.analysis = await models.analyzeAd({ image: ad.snapshotRef ? { dataUrl: await inlineImageHref(ad.snapshotRef) } : undefined, body: ad.body, title: ad.title, pageName: ad.pageName });
    } catch (err) {
      await log(`Couldn't read the ${ad.pageName} ad (${(err as Error).message.slice(0, 60)})`, "warn");
    }
  });
  await log(`Read ${ads.filter((a) => a.analysis).length} ads with Muse Spark`, "info");

  const insights = await models.synthesize(brief, o.brand, ads.filter((a) => a.analysis));
  for (const w of insights.whiteSpace.slice(0, 2)) await log(`Opening: ${w}`, "decision");
  const kinds = new Set(ads.map((a) => a.source));
  const source = kinds.size > 1 ? "mixed" : kinds.has("ad_library") ? "ad_library" : kinds.has("site") ? "sites" : "uploads";
  return { searchTerms: terms, competitors: plan.competitors, source, note, ads, insights };
}
