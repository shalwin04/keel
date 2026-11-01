import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  BriefSchema, type AdPerformance, type Brief, type Direction, type Learning, type Move, type PerformanceSnapshot, type Research, type SiteProfile,
} from "@keel/core";
import { schema, type Db } from "@keel/db";
import { crawlSite, inlineImageHref, type AdsGraphClient, type SiteCrawl } from "@keel/meta";
import type { StudioModels } from "./studio/models.ts";
import type { LaunchInfo, Studio } from "./studio/pipeline.ts";

export type AutopilotStage = "site" | "research" | "craft" | "launch" | "learn" | "update";
export interface AutopilotLog { at: string; stage: AutopilotStage; text: string; kind: "info" | "decision" | "warn" }
export interface AutopilotSettings { dailyBudget: number; maxDailyBudget: number; checkEveryHours: number; minImpressions: number }
export type AutopilotRow = typeof schema.autopilots.$inferSelect;

export interface AutopilotDeps {
  db: Db;
  models: StudioModels;
  studio: Studio;
  audit(actor: string, event: string, payload: unknown): Promise<void>;
  adsFor(accountId: string): Promise<AdsGraphClient>;
  crawl?: typeof crawlSite;
}

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const CURRENCY_OF: Record<string, string> = { IN: "INR", US: "USD", GB: "GBP", AE: "AED", SG: "SGD", AU: "AUD", CA: "CAD", DE: "EUR", FR: "EUR", NL: "EUR", ES: "EUR", IT: "EUR" };

/** "3499.00" + INR → "₹3,499". Prices that already carry a symbol are kept as written. */
export function formatPrice(price: string | undefined, currency: string | undefined, country: string): string {
  if (!price) return "";
  const n = Number(price.replace(/,/g, ""));
  if (!Number.isFinite(n)) return price.slice(0, 40);
  const cur = currency || CURRENCY_OF[country] || "USD";
  try {
    return new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-US", { style: "currency", currency: cur, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch { return price; }
}

/** The brief Studio needs, written from what the agent read on the site. */
export function briefFromSite(site: SiteCrawl, profile: SiteProfile, dailyBudget: number): { brief: Brief; hero: SiteCrawl["products"][number] | undefined } {
  const hero = site.products[profile.heroProduct] ?? site.products[0];
  const photos = hero?.imageRefs.length ? hero.imageRefs : site.shareImageRef ? [site.shareImageRef] : [];
  if (!photos.length) throw new Error("Couldn't find any product photos on the site. Start from a brief instead and upload a photo.");
  const country = profile.audience.countries[0] ?? "IN";
  const brief = BriefSchema.parse({
    productName: (hero?.name ?? profile.brand.name).slice(0, 120),
    productUrl: hero?.url?.split("#")[0] || site.url,
    productPhotos: photos.slice(0, 3),
    price: formatPrice(hero?.price, hero?.currency, country),
    offer: profile.offer,
    audience: profile.audience.summary,
    countries: profile.audience.countries,
    ageMin: Math.min(profile.audience.ageMin, profile.audience.ageMax),
    ageMax: Math.max(profile.audience.ageMin, profile.audience.ageMax),
    dailyBudget,
    startDate: day(1),
    endDate: day(15),
    notes: [
      profile.brand.oneLiner && `Brand: ${profile.brand.oneLiner}`,
      profile.brand.voice && `Voice: ${profile.brand.voice}`,
      profile.brand.values.length && `Values: ${profile.brand.values.join(", ")}`,
      `Brand palette from the website: base ${profile.brand.palette.base}, accent ${profile.brand.palette.accent}, ink ${profile.brand.palette.ink}. Keep directions on-brand.`,
      profile.heroWhy && `Why this product: ${profile.heroWhy}`,
      profile.goal && `Goal: ${profile.goal}`,
      profile.notes,
    ].filter(Boolean).join("\n").slice(0, 2000),
    competitors: profile.competitors.slice(0, 6),
    brand: profile.brand.name,
    logoRef: site.logoRef,
  });
  return { brief, hero };
}

/**
 * The deterministic part of "update": which moves the numbers justify. The model explains and proposes a creative idea;
 * pausing, budget and new ads only follow from thresholds here, and every move waits for a person.
 */
export function planMoves(o: { perf: PerformanceSnapshot; learning: Learning | undefined; settings: AutopilotSettings; launch: LaunchInfo; existing: Move[]; directions: number }): Omit<Move, "id" | "status" | "createdAt">[] {
  const { perf, learning, settings, launch } = o;
  const open = (k: Move["kind"], f: (m: Move) => boolean = () => true) => o.existing.some((m) => m.kind === k && (m.status === "pending" || m.status === "running") && f(m));
  const out: Omit<Move, "id" | "status" | "createdAt">[] = [];
  const active = perf.ads.filter((a) => a.status === "ACTIVE");
  const mature = active.filter((a) => a.impressions >= settings.minImpressions);
  const best = [...mature].sort((a, b) => b.ctr - a.ctr)[0];
  let remaining = active.length;
  if (best && mature.length >= 2) {
    for (const a of mature) {
      if (a === best || a.ctr >= best.ctr * 0.5 || remaining <= 1 || open("pause_ad", (m) => m.params.adId === a.adId)) continue;
      remaining--;
      out.push({ kind: "pause_ad", title: `Pause "${a.title}"`, why: `${a.ctr.toFixed(2)}% CTR after ${a.impressions.toLocaleString()} impressions, under half of "${best.title}" (${best.ctr.toFixed(2)}%). Its budget goes to the ads that work.`, params: { adId: a.adId, direction: a.direction } });
    }
  }
  const spent = perf.totals.spend;
  const next = Math.round(settings.dailyBudget * 1.25);
  if (launch.active && learning?.winner != null && learning.confidence !== "low" && best && best.ctr >= 1 && spent >= settings.dailyBudget * 2 && next <= settings.maxDailyBudget && !open("scale_budget")) {
    out.push({ kind: "scale_budget", title: `Raise the daily budget to ${next.toLocaleString()} ${perf.currency}`, why: `"${best.title}" is a clear winner at ${best.ctr.toFixed(2)}% CTR with real volume. A 25% step keeps Meta's learning phase stable. Your cap is ${settings.maxDailyBudget.toLocaleString()}.`, params: { dailyBudget: next } });
  }
  if (learning?.nextIdea && learning.confidence !== "low" && o.directions < 6 && !open("new_variant")) {
    out.push({ kind: "new_variant", title: `Add a new variant: "${learning.nextIdea.title}"`, why: learning.nextIdea.why || `Builds on what's working in the winning direction and tests one new idea.`, params: { idea: learning.nextIdea, direction: learning.nextIdea.basedOn } });
  }
  return out;
}

export function createAutopilot(d: AutopilotDeps) {
  const { db } = d;
  const crawl = d.crawl ?? crawlSite;

  /** Read-modify-write on one autopilot under a Postgres advisory lock (the API and the worker both write). */
  async function mutate(id: string, fn: (row: AutopilotRow) => Partial<AutopilotRow> | undefined) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`autopilot:${id}`}))`);
      const [row] = await tx.select().from(schema.autopilots).where(eq(schema.autopilots.id, id));
      if (!row) throw new Error("not found");
      const patch = fn(row);
      if (patch) await tx.update(schema.autopilots).set({ ...patch, updatedAt: new Date() }).where(eq(schema.autopilots.id, id));
      return { ...row, ...patch } as AutopilotRow;
    });
  }
  const get = async (id: string) => (await db.select().from(schema.autopilots).where(eq(schema.autopilots.id, id)))[0];
  const log = (id: string, stage: AutopilotStage, text: string, kind: AutopilotLog["kind"] = "info") =>
    mutate(id, (r) => ({ log: [...((r.log ?? []) as AutopilotLog[]), { at: new Date().toISOString(), stage, text, kind }].slice(-300) })).catch(() => undefined);
  const settingsOf = (r: AutopilotRow) => r.settings as AutopilotSettings;

  async function start(o: { workspaceId: string; brandId: string; accountId: string; url: string; userId: string; dailyBudget: number; maxDailyBudget?: number; checkEveryHours?: number }) {
    const id = randomUUID();
    const settings: AutopilotSettings = {
      dailyBudget: o.dailyBudget, maxDailyBudget: o.maxDailyBudget ?? o.dailyBudget * 2,
      checkEveryHours: o.checkEveryHours ?? Number(process.env.AUTOPILOT_CHECK_HOURS ?? 6), minImpressions: Number(process.env.AUTOPILOT_MIN_IMPRESSIONS ?? 1000),
    };
    await db.insert(schema.autopilots).values({ id, workspaceId: o.workspaceId, brandId: o.brandId, accountId: o.accountId, url: o.url, status: "reading", settings, moves: [], log: [], learnings: [], performance: [], createdBy: o.userId });
    await d.audit(o.userId, "autopilot.started", { autopilotId: id, accountId: o.accountId, url: o.url });
    void run(id);
    return id;
  }

  /** Read the site → profile the brand → brief → Studio (research, strategy, art direction, layouts, checks, storyboard). */
  async function run(id: string) {
    const ap = await get(id);
    if (!ap) return;
    try {
      await mutate(id, () => ({ status: "reading", error: null }));
      await log(id, "site", `Reading ${ap.url}`);
      const site = await crawl(ap.url, { log: (t) => void log(id, "site", t) });
      const images = await Promise.all([site.screenshotRef, ...site.products.slice(0, 4).map((p) => p.imageRefs[0]!)].map(async (r) => ({ dataUrl: await inlineImageHref(r) })));
      const profile = await d.models.readSite(site, images);
      profile.heroProduct = Math.min(Math.max(0, profile.heroProduct), Math.max(0, site.products.length - 1));
      await mutate(id, () => ({ site: { ...site, text: site.text.slice(0, 1500) }, profile }));
      await log(id, "site", `${profile.brand.name}: ${profile.brand.oneLiner}`, "decision");
      await log(id, "site", `Audience: ${profile.audience.summary} (${profile.audience.ageMin}-${profile.audience.ageMax}, ${profile.audience.countries.join(", ")})`, "decision");
      const { brief, hero } = briefFromSite(site, profile, settingsOf(ap).dailyBudget);
      if (hero) await log(id, "site", `Leading with ${hero.name}${brief.price ? ` (${brief.price})` : ""}: ${profile.heroWhy}`, "decision");
      if (profile.offer) await log(id, "site", `Live offer on the site: ${profile.offer}`, "decision");

      await mutate(id, () => ({ status: "crafting" }));
      const projectId = await d.studio.create({ workspaceId: ap.workspaceId, brandId: ap.brandId, accountId: ap.accountId, name: `${profile.brand.name} · ${brief.productName}`.slice(0, 80), brief, userId: ap.createdBy, start: false });
      await mutate(id, () => ({ projectId }));
      await log(id, "research", `Researching ${brief.competitors.length ? brief.competitors.join(", ") : "the category"} on Meta`);
      await d.studio.run(projectId);
      const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
      if (!p || p.status !== "ready") throw new Error(p?.error ?? "the campaign couldn't be drafted");
      const research = p.research as Research | null;
      if (research?.insights.whiteSpace.length) await log(id, "research", `Open space: ${research.insights.whiteSpace.slice(0, 2).join("; ")}`, "decision");

      // The agent picks what to launch: every direction that passed its own check (all of them if none did).
      const designs = await db.select().from(schema.studioDesigns).where(eq(schema.studioDesigns.projectId, projectId));
      const passed = [...new Set(designs.filter((x) => (x.check as { pass?: boolean } | null)?.pass).map((x) => x.direction))];
      const pick = passed.length ? passed : [...new Set(designs.map((x) => x.direction))];
      await db.update(schema.studioDesigns).set({ picked: true }).where(and(eq(schema.studioDesigns.projectId, projectId), inArray(schema.studioDesigns.direction, pick)));
      const dirs = (p.directions ?? []) as Direction[];
      await log(id, "craft", `${pick.length} direction${pick.length > 1 ? "s" : ""} ready to test: ${pick.map((i) => dirs[i]?.title).join(", ")}`, "decision");
      await mutate(id, () => ({ status: "ready" }));
      await log(id, "launch", "Waiting for your go-ahead to launch", "info");
      await d.audit("keel", "autopilot.ready", { autopilotId: id, projectId, directions: pick.length });
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await mutate(id, () => ({ status: "failed", error: msg }));
      await log(id, "site", msg, "warn");
    }
  }

  async function projectOf(r: AutopilotRow) {
    if (!r.projectId) throw new Error("no campaign yet");
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, r.projectId));
    if (!p) throw new Error("campaign missing");
    return p;
  }

  async function activate(r: AutopilotRow) {
    const p = await projectOf(r);
    const launch = p.launch as LaunchInfo;
    const ads = await d.adsFor(r.accountId);
    // Ads first, then the ad set, then the campaign: nothing spends until the last switch.
    for (const a of launch.ads) await ads.setStatus(a.adId, "ACTIVE");
    await ads.setStatus(launch.adsetId, "ACTIVE");
    await ads.setStatus(launch.campaignId, "ACTIVE");
    await db.update(schema.studioProjects).set({ launch: { ...launch, active: true }, updatedAt: new Date() }).where(eq(schema.studioProjects.id, p.id));
  }

  /** The person's go-ahead: create everything (paused, enhancements locked), and switch it on if they said so. */
  async function launch(id: string, userId: string, goLive: boolean) {
    const r = await get(id);
    if (!r) throw new Error("not found");
    if (r.status !== "ready") throw new Error("not ready to launch");
    await mutate(id, () => ({ status: "launching", error: null }));
    try {
      const l = await d.studio.launch(r.projectId!, userId);
      await log(id, "launch", `Created the campaign with ${l.ads.length} ads, paused, AI enhancements locked off`, "decision");
      const hours = settingsOf(r).checkEveryHours;
      if (goLive) {
        await activate(r);
        await log(id, "launch", "Switched on. First read of the results in " + (hours < 2 ? "an hour" : `${hours} hours`), "decision");
      }
      await mutate(id, (row) => ({
        status: "live", nextCheckAt: new Date(Date.now() + hours * 3_600_000),
        moves: goLive ? row.moves : [...((row.moves ?? []) as Move[]), { id: randomUUID(), kind: "go_live", title: "Switch the campaign on", why: `Starts spending up to ${settingsOf(row).dailyBudget.toLocaleString()} a day. Keel reads the results every ${hours} hours and proposes changes.`, params: {}, status: "pending", createdAt: new Date().toISOString() } as Move],
      }));
      await d.audit(userId, "autopilot.launched", { autopilotId: id, accountId: r.accountId, campaignId: l.campaignId, live: goLive });
    } catch (err) {
      await mutate(id, () => ({ status: "ready", error: (err as Error).message.slice(0, 500) }));
      await log(id, "launch", `Launch failed: ${(err as Error).message.slice(0, 200)}`, "warn");
      throw err;
    }
  }

  /** Learn: read results from Meta, have the model explain them, and turn the numbers into proposed moves. */
  async function check(id: string) {
    const r = await get(id);
    if (!r || r.status !== "live") return;
    const settings = settingsOf(r);
    const next = new Date(Date.now() + settings.checkEveryHours * 3_600_000);
    try {
      const p = await projectOf(r);
      const launch = p.launch as LaunchInfo;
      const dirs = (p.directions ?? []) as Direction[];
      const ads = await d.adsFor(r.accountId);
      const [rows, statuses] = await Promise.all([ads.adInsights(r.accountId, launch.ads.map((a) => a.adId)), ads.statuses(launch.ads.map((a) => a.adId)).catch(() => ({} as Record<string, string>))]);
      const perfAds: AdPerformance[] = launch.ads.map((a) => {
        const m = rows.find((x) => x.adId === a.adId);
        return { adId: a.adId, direction: a.direction, title: dirs[a.direction]?.title ?? a.adId, status: statuses[a.adId] ?? (launch.active ? "ACTIVE" : "PAUSED"), impressions: m?.impressions ?? 0, reach: m?.reach ?? 0, clicks: m?.clicks ?? 0, ctr: m?.ctr ?? 0, cpc: m?.cpc ?? 0, spend: m?.spend ?? 0, frequency: m?.frequency ?? 0 };
      });
      const t = perfAds.reduce((s, a) => ({ impressions: s.impressions + a.impressions, clicks: s.clicks + a.clicks, spend: s.spend + a.spend }), { impressions: 0, clicks: 0, spend: 0 });
      const perf: PerformanceSnapshot = { at: new Date().toISOString(), currency: launch.currency ?? "", ads: perfAds, totals: { ...t, ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0 } };
      await mutate(id, (row) => ({ performance: [...((row.performance ?? []) as PerformanceSnapshot[]), perf].slice(-60), nextCheckAt: next }));
      if (!t.impressions) {
        await log(id, "learn", launch.active ? "No delivery yet (Meta may still be reviewing the ads)" : "The campaign is paused, so there are no results to learn from yet");
        return;
      }
      await log(id, "learn", `${t.impressions.toLocaleString()} impressions, ${t.clicks.toLocaleString()} clicks, ${perf.totals.ctr.toFixed(2)}% CTR, ${t.spend.toFixed(2)} ${perf.currency} spent`);
      const history = (r.learnings ?? []) as Learning[];
      const brief = BriefSchema.parse(p.brief);
      const learned = await d.models.learn({ brand: brief.brand ?? "", product: brief.productName, directions: dirs, perf, history, insights: (p.research as Research | null)?.insights });
      const learning: Learning = { ...learned, at: perf.at, impressions: t.impressions };
      await log(id, "learn", learning.summary, "decision");
      const moves = planMoves({ perf, learning, settings, launch, existing: (r.moves ?? []) as Move[], directions: dirs.length });
      await mutate(id, (row) => ({
        learnings: [...((row.learnings ?? []) as Learning[]), learning].slice(-30),
        moves: [...((row.moves ?? []) as Move[]), ...moves.map((m) => ({ ...m, id: randomUUID(), status: "pending", createdAt: new Date().toISOString() }) as Move)],
      }));
      for (const m of moves) await log(id, "update", `Proposed: ${m.title}`, "decision");
      await d.audit("keel", "autopilot.learned", { autopilotId: id, impressions: t.impressions, winner: learning.winner, moves: moves.map((m) => m.kind) });
    } catch (err) {
      await mutate(id, () => ({ nextCheckAt: next }));
      await log(id, "learn", `Couldn't read results: ${(err as Error).message.slice(0, 200)}`, "warn");
    }
  }

  async function execute(r: AutopilotRow, m: Move, userId: string): Promise<string> {
    const p = await projectOf(r);
    const launch = p.launch as LaunchInfo;
    const ads = await d.adsFor(r.accountId);
    switch (m.kind) {
      case "go_live":
        await activate(r);
        return "The campaign, ad set and ads are on";
      case "pause_ad":
        await ads.setStatus(m.params.adId!, "PAUSED");
        return "Ad paused";
      case "scale_budget": {
        const minor = launch.minor ?? 100;
        await ads.setDailyBudget(launch.adsetId, m.params.dailyBudget! * minor);
        await mutate(r.id, (row) => ({ settings: { ...settingsOf(row), dailyBudget: m.params.dailyBudget! } }));
        return `Daily budget is now ${m.params.dailyBudget!.toLocaleString()}`;
      }
      case "new_variant": {
        const idea = m.params.idea!;
        const base = ((p.directions ?? []) as Direction[])[idea.basedOn];
        if (!base) throw new Error("the winning direction is gone");
        const dir: Direction = { ...base, title: idea.title, angle: idea.angle, hook: idea.hook, headline: idea.headline, subline: idea.subline, primaryText: idea.primaryText, scenePrompt: idea.scenePrompt, rationale: idea.why };
        const idx = await d.studio.addDirection(p.id, dir);
        const ad = await d.studio.extendLaunch(p.id, idx, userId, !!launch.active);
        return `New ad ${ad.adId} added${launch.active ? " and running" : " (paused, like the campaign)"}`;
      }
    }
  }

  /** A person approves or dismisses a proposed move. Approved moves run in the background and report back. */
  async function decide(id: string, moveId: string, userId: string, approve: boolean) {
    const box: { move?: Move } = {};
    const row = await mutate(id, (r) => {
      const moves = (r.moves ?? []) as Move[];
      const found = moves.find((m) => m.id === moveId);
      if (!found || found.status !== "pending") return undefined;
      box.move = { ...found, status: approve ? "running" : "dismissed", decidedAt: new Date().toISOString(), decidedBy: userId };
      return { moves: moves.map((m) => (m.id === moveId ? box.move! : m)) };
    });
    const move = box.move;
    if (!move) throw new Error("that proposal isn't waiting for a decision");
    await d.audit(userId, approve ? "autopilot.move_approved" : "autopilot.move_dismissed", { autopilotId: id, moveId, kind: move.kind, params: move.params });
    await log(id, "update", `${approve ? "Approved" : "Dismissed"}: ${move.title}`);
    if (!approve) return move;
    const m = move;
    void (async () => {
      let status: Move["status"] = "done", result: string;
      try { result = await execute(row, m, userId); }
      catch (err) { status = "failed"; result = (err as Error).message.slice(0, 300); }
      await mutate(id, (r) => ({ moves: ((r.moves ?? []) as Move[]).map((x) => (x.id === moveId ? { ...x, status, result } : x)) }));
      await log(id, "update", `${m.title}: ${result}`, status === "done" ? "decision" : "warn");
      await d.audit(userId, status === "done" ? "autopilot.move_done" : "autopilot.move_failed", { autopilotId: id, moveId, kind: m.kind, result });
    })();
    return move;
  }

  async function setStopped(id: string, stopped: boolean, userId: string) {
    await mutate(id, (r) => (stopped ? (r.status === "live" ? { status: "stopped" } : undefined) : r.status === "stopped" ? { status: "live", nextCheckAt: new Date() } : undefined));
    await log(id, "learn", stopped ? "Autopilot paused: no more checks or proposals until you resume it" : "Autopilot resumed");
    await d.audit(userId, stopped ? "autopilot.stopped" : "autopilot.resumed", { autopilotId: id });
  }

  /** Live autopilots whose next look at the results is due. */
  async function due(now = new Date()) {
    const rows = await db.select({ id: schema.autopilots.id }).from(schema.autopilots).where(and(eq(schema.autopilots.status, "live"), lte(schema.autopilots.nextCheckAt, now)));
    return rows.map((r) => r.id);
  }

  async function list(workspaceIds: string[]) {
    if (!workspaceIds.length) return [];
    return db.select().from(schema.autopilots).where(inArray(schema.autopilots.workspaceId, workspaceIds)).orderBy(desc(schema.autopilots.createdAt)).limit(50);
  }

  return { start, run, launch, check, decide, setStopped, due, list, get };
}
export type Autopilot = ReturnType<typeof createAutopilot>;
