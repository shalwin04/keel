import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  BriefSchema, DesignDocSchema, RulebookSchema, SIZES, TEMPLATES, compose, designToSvg, relayout,
  type Brief, type DesignDoc, type Direction, type Research, type Rulebook, type SizeKey, type TemplateKey,
} from "@keel/core";
import { schema, type Db } from "@keel/db";
import { type AdsGraphClient, inlineImageHref, readMedia, renderSvgToPng, saveMedia } from "@keel/meta";
import type { SceneRanking, StudioModels } from "./models.ts";
import { gatherResearch } from "./research.ts";

export type StepKey = "research" | "strategy" | "scenes" | "compose" | "check" | "storyboard";
export interface Step { key: StepKey; label: string; status: "waiting" | "running" | "done" | "failed" | "skipped"; detail?: string; ms?: number }
const STEPS: Step[] = [
  { key: "research", label: "Research competitors' ads", status: "waiting" },
  { key: "strategy", label: "Plan three directions and their storyboards", status: "waiting" },
  { key: "scenes", label: "Shoot, art-direct and refine the hero images", status: "waiting" },
  { key: "compose", label: "Lay out every size with your real product", status: "waiting" },
  { key: "check", label: "Check each design before you see it", status: "waiting" },
  { key: "storyboard", label: "Draw the Reel storyboard", status: "waiting" },
];
export interface LogEntry { at: string; step: StepKey; text: string; kind: "info" | "decision" | "warn" }
type DirRow = Direction & { sceneRef: string; sceneHistory: string[]; productInScene?: boolean; ranking?: SceneRanking; frames?: (string | null)[] };

/** The features Studio switches off on new creatives, plus any the rulebook locks. Meta's own defaults are never trusted. */
export const STUDIO_LOCKED_FEATURES = [
  "image_touchups", "image_templates", "image_uncrop", "image_background_gen", "text_optimizations", "text_generation", "inline_comment",
  "enhance_cta", "music", "image_animation", "add_text_overlay", "description_automation", "image_brightness_and_contrast", "adapt_to_placement",
  "site_extensions", "product_extensions", "pac_recomposition", "video_auto_crop",
];

export interface LaunchedAd { designId: string; direction: number; adId: string; creativeId: string }
export interface LaunchInfo { campaignId: string; adsetId: string; pageId: string; ads: LaunchedAd[]; at: string; currency?: string; minor?: number; active?: boolean; dailyBudget?: number }

const lockedFeatures = (rulebook?: Rulebook) => Object.fromEntries([...new Set([...STUDIO_LOCKED_FEATURES, ...(rulebook?.lockedEnhancements ?? [])])].map((k) => [k, "OPT_OUT"]));

export interface StudioDeps {
  db: Db;
  models: StudioModels;
  audit(actor: string, event: string, payload: unknown): Promise<void>;
  adsFor(accountId: string): Promise<AdsGraphClient>;
}

const imageInput = async (ref: string) => ({ dataUrl: await inlineImageHref(ref) });

export function createStudio(d: StudioDeps) {
  const { db } = d;

  async function setStep(projectId: string, key: StepKey, patch: Partial<Step>) {
    const [p] = await db.select({ steps: schema.studioProjects.steps }).from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    const steps = ((p?.steps ?? STEPS) as Step[]).map((s) => (s.key === key ? { ...s, ...patch } : s));
    await db.update(schema.studioProjects).set({ steps, updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
  }

  async function timed<T>(projectId: string, key: StepKey, fn: () => Promise<{ value: T; detail?: string }>) {
    const t0 = Date.now();
    await setStep(projectId, key, { status: "running" });
    try {
      const r = await fn();
      await setStep(projectId, key, { status: "done", ms: Date.now() - t0, detail: r.detail });
      return r.value;
    } catch (err) {
      await setStep(projectId, key, { status: "failed", ms: Date.now() - t0, detail: (err as Error).message });
      throw err;
    }
  }

  /** The agent's running commentary: what it found and what it decided, shown live on the project page. */
  async function log(projectId: string, step: StepKey, text: string, kind: LogEntry["kind"] = "info") {
    const [p] = await db.select({ log: schema.studioProjects.log }).from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    const entries = [...((p?.log ?? []) as LogEntry[]), { at: new Date().toISOString(), step, text, kind }].slice(-200);
    await db.update(schema.studioProjects).set({ log: entries }).where(eq(schema.studioProjects.id, projectId));
  }

  const CANDIDATES = Math.max(1, Math.min(3, Number(process.env.STUDIO_CANDIDATES ?? 2)));

  /**
   * Art direction for one hero image: shoot a few candidates, let Muse Spark rank them as an art director would,
   * and if the winner still has a fixable flaw, have Muse Image fix exactly that (once).
   */
  async function artDirect(projectId: string, dir: Direction, brief: Brief, product: { dataUrl: string }[], label: string) {
    const shots = await Promise.all(Array.from({ length: CANDIDATES }, (_, k) => d.models.generateScene(dir, brief, product, k).catch((err: Error) => { void log(projectId, "scenes", `${label}: one take failed (${err.message.slice(0, 80)})`, "warn"); return undefined; })));
    const ok = shots.filter((x): x is NonNullable<typeof x> => !!x);
    if (!ok.length) throw new Error(`no image came back for ${label}`);
    const refs = await Promise.all(ok.map((x) => saveMedia(x.bytes, ".png", "scenes")));
    let best = 0;
    let ranking: SceneRanking | undefined;
    if (refs.length > 1 || product[0]) {
      try {
        ranking = await d.models.rankScenes(await Promise.all(refs.map(imageInput)), product[0]!, dir);
        best = Math.min(refs.length - 1, Math.max(0, ranking.best));
        const sc = ranking.scores.find((x) => x.index === best);
        await log(projectId, "scenes", `${label}: picked take ${best + 1} of ${refs.length}${sc ? ` (score ${Math.round(sc.score * 100)}, product ${Math.round(sc.product * 100)}, look ${Math.round(sc.aesthetics * 100)})` : ""}${sc?.notes ? ` · ${sc.notes}` : ""}`, "decision");
      } catch (err) {
        await log(projectId, "scenes", `${label}: ranking skipped (${(err as Error).message.slice(0, 80)})`, "warn");
      }
    }
    let ref = refs[best]!;
    const bestScore = ranking?.scores.find((x) => x.index === best)?.score ?? 1;
    if (ranking?.fix && bestScore < 0.85) {
      try {
        ref = await saveMedia(await d.models.refineScene(await imageInput(ref), ranking.fix, brief), ".png", "scenes");
        await log(projectId, "scenes", `${label}: refined — ${ranking.fix}`, "decision");
      } catch (err) {
        await log(projectId, "scenes", `${label}: refinement skipped (${(err as Error).message.slice(0, 80)})`, "warn");
      }
    }
    return { ref, productInScene: ok[best]!.productInScene, ranking, takes: refs };
  }

  /** The agent picks the layout that suits where the image has room for type. */
  function layoutFor(r: SceneRanking | undefined, fallback: TemplateKey): TemplateKey {
    if (!r) return fallback;
    if (r.space === "left" || r.space === "right") return "split";
    if (r.space === "none") return "card";
    return fallback === "split" ? "split" : "hero";
  }

  async function brandContext(brandId: string, brief?: Brief): Promise<{ name: string; rulebook?: Rulebook }> {
    const [b] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
    const [rb] = await db.select().from(schema.rulebooks).where(eq(schema.rulebooks.brandId, brandId)).orderBy(desc(schema.rulebooks.version)).limit(1);
    const parsed = rb ? RulebookSchema.safeParse(rb.rules) : undefined;
    return { name: brief?.brand || b?.name || "Brand", rulebook: parsed?.success ? parsed.data : undefined };
  }

  async function renderDesign(doc: DesignDoc): Promise<string> {
    const refs = [...new Set(doc.layers.filter((l) => l.kind === "image").map((l) => (l as { ref: string }).ref))];
    const map = new Map(await Promise.all(refs.map(async (r) => [r, await inlineImageHref(r)] as const)));
    const png = await renderSvgToPng(designToSvg(doc, (r) => map.get(r) ?? r), doc.w, doc.h);
    return saveMedia(png, ".png", "studio");
  }

  function composeInput(brief: Brief, brand: string, direction: Direction, sceneRef: string, productInScene = false) {
    return { sceneRef, productRef: brief.productPhotos[0]!, brand, direction, price: brief.price || undefined, offer: brief.offer || undefined, productInScene, logoRef: brief.logoRef };
  }

  /**
   * The agent run: research → strategy (directions, art briefs, storyboards) → art-directed hero images →
   * layouts in every size → self-check → Reel storyboard frames. Each step logs what it found and decided.
   */
  async function run(projectId: string) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) return;
    const brief = BriefSchema.parse(p.brief);
    const { name: brand, rulebook } = await brandContext(p.brandId, brief);
    const product = await Promise.all(brief.productPhotos.slice(0, 3).map(imageInput));
    try {
      const research = await timed(projectId, "research", async () => {
        const r: Research = await gatherResearch({ models: d.models, brief, brand, log: (t, k) => log(projectId, "research", t, k) });
        await db.update(schema.studioProjects).set({ research: r }).where(eq(schema.studioProjects.id, projectId));
        return { value: r, detail: r.ads.length ? `${r.ads.length} ads from ${new Set(r.ads.map((a) => a.pageName)).size} advertisers · ${r.insights.whiteSpace[0] ?? r.insights.summary.slice(0, 80)}` : r.note ?? "no competitor ads found" };
      });

      const directions = await timed(projectId, "strategy", async () => {
        const ds = (await d.models.planDirections(brief, brand, product, rulebook, research.ads.length ? research.insights : undefined)).slice(0, 3);
        if (!ds.length) throw new Error("no directions came back");
        for (const x of ds) await log(projectId, "strategy", `${x.title}: ${x.rationale || x.angle}`, "decision");
        return { value: ds, detail: ds.map((x) => x.title).join(" · ") };
      });

      const scenes = await timed(projectId, "scenes", async () => {
        const made = await Promise.all(directions.map((dir) => artDirect(projectId, dir, brief, product, dir.title)));
        return { value: made, detail: `${made.length} hero images from ${made.reduce((n, m) => n + m.takes.length, 0)} takes${made.every((m) => m.productInScene) ? " · your product in each" : ""}` };
      });
      const dirRows: DirRow[] = directions.map((dir, i) => ({ ...dir, sceneRef: scenes[i]!.ref, productInScene: scenes[i]!.productInScene, ranking: scenes[i]!.ranking, sceneHistory: [...scenes[i]!.takes, scenes[i]!.ref].filter((v, k, a) => a.indexOf(v) === k).slice(-6) }));
      await db.update(schema.studioProjects).set({ directions: dirRows }).where(eq(schema.studioProjects.id, projectId));

      await timed(projectId, "compose", async () => {
        await db.delete(schema.studioDesigns).where(eq(schema.studioDesigns.projectId, projectId));
        let n = 0;
        for (const [i, dir] of dirRows.entries()) {
          const template = layoutFor(dir.ranking, TEMPLATES[i % TEMPLATES.length]!);
          if (dir.ranking) await log(projectId, "compose", `${dir.title}: ${template} layout (open space ${dir.ranking.space})`, "decision");
          for (const size of Object.keys(SIZES) as SizeKey[]) {
            const doc = compose({ ...composeInput(brief, brand, dir, dir.sceneRef, dir.productInScene), template, size });
            await db.insert(schema.studioDesigns).values({ id: randomUUID(), projectId, direction: i, size, doc, renderRef: await renderDesign(doc) });
            n++;
          }
        }
        return { value: n, detail: `${n} designs in 3 sizes` };
      });

      await timed(projectId, "check", async () => {
        const productRef = brief.productPhotos[0]!;
        let passed = 0, fixed = 0;
        for (const [i, dir] of directions.entries()) {
          const [sq] = await db.select().from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, i), eq(schema.studioDesigns.size, "square")));
          if (!sq?.renderRef) continue;
          let check = await d.models.critique(await imageInput(sq.renderRef), await imageInput(productRef), dir, rulebook);
          if (!check.pass && check.score < 0.5) {
            await log(projectId, "check", `${dir.title}: failed the check (${check.issues[0] ?? "low score"}), reshooting`, "decision");
            await regenerateScene(projectId, i, false);
            const [again] = await db.select().from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, i), eq(schema.studioDesigns.size, "square")));
            check = await d.models.critique(await imageInput(again!.renderRef!), await imageInput(productRef), dir, rulebook);
            fixed++;
          }
          if (check.pass) passed++;
          else await log(projectId, "check", `${dir.title}: ${check.issues.join("; ")}`, "warn");
          await db.update(schema.studioDesigns).set({ check }).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, i)));
        }
        return { value: passed, detail: `${passed} of ${directions.length} ready${fixed ? ` · ${fixed} reshot` : ""}` };
      });

      // The storyboard for the strongest direction is drawn now; the others on request.
      await timed(projectId, "storyboard", async () => {
        const n = await drawStoryboard(projectId, 0);
        return { value: n, detail: n ? `${n} frames for "${directions[0]!.title}"` : "no Reel shots planned" };
      }).catch(() => undefined);

      await db.update(schema.studioProjects).set({ status: "ready", updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
      await d.audit(p.createdBy, "studio.drafted", { projectId, accountId: p.accountId, directions: directions.length, competitorAds: research.ads.length });
    } catch (err) {
      await db.update(schema.studioProjects).set({ status: "failed", error: (err as Error).message.slice(0, 500), updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
    }
  }

  /** Draws one frame per Reel shot for a direction (in parallel), keeping the real product in product shots. */
  async function drawStoryboard(projectId: string, direction: number) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) throw new Error("not found");
    const brief = BriefSchema.parse(p.brief);
    const dirs = (p.directions ?? []) as DirRow[];
    const dir = dirs[direction];
    if (!dir?.storyboard.reel.length) return 0;
    const product = await Promise.all(brief.productPhotos.slice(0, 2).map(imageInput));
    const frames = await Promise.all(dir.storyboard.reel.map(async (shot, k) => {
      try { return await saveMedia(await d.models.storyboardFrame(shot, dir, brief, product), ".png", "storyboard"); }
      catch (err) { await log(projectId, "storyboard", `Shot ${k + 1}: ${(err as Error).message.slice(0, 80)}`, "warn"); return null; }
    }));
    const [fresh] = await db.select({ directions: schema.studioProjects.directions }).from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    const rows = (fresh?.directions ?? dirs) as DirRow[];
    rows[direction] = { ...rows[direction]!, frames };
    await db.update(schema.studioProjects).set({ directions: rows, updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
    return frames.filter(Boolean).length;
  }

  async function regenerateScene(projectId: string, direction: number, audit = true) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) throw new Error("not found");
    const brief = BriefSchema.parse(p.brief);
    const { name: brand } = await brandContext(p.brandId, brief);
    const dirs = (p.directions ?? []) as DirRow[];
    const dir = dirs[direction];
    if (!dir) throw new Error("no such direction");
    const product = await Promise.all(brief.productPhotos.slice(0, 2).map(imageInput));
    const scene = await artDirect(projectId, dir, brief, product, dir.title);
    const sceneRef = scene.ref;
    dirs[direction] = { ...dir, sceneRef, productInScene: scene.productInScene, ranking: scene.ranking, sceneHistory: [...(dir.sceneHistory ?? []), ...scene.takes, sceneRef].filter((v, k, a) => a.indexOf(v) === k).slice(-8) };
    await db.update(schema.studioProjects).set({ directions: dirs, updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
    await useScene(projectId, direction, sceneRef);
    if (audit) await d.audit(p.createdBy, "studio.scene_regenerated", { projectId, direction });
    return sceneRef;
  }

  /** Puts a scene behind every size of one direction, keeping each design's other edits. */
  async function useScene(projectId: string, direction: number, sceneRef: string) {
    const designs = await db.select().from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, direction)));
    for (const des of designs) {
      const doc = DesignDocSchema.parse(des.doc);
      const next = { ...doc, layers: doc.layers.map((l) => (l.kind === "image" && l.role === "scene" ? { ...l, ref: sceneRef } : l)) };
      await db.update(schema.studioDesigns).set({ doc: next, renderRef: await renderDesign(next), check: null, updatedAt: new Date() }).where(eq(schema.studioDesigns.id, des.id));
    }
  }

  async function saveDesign(designId: string, doc: DesignDoc) {
    const parsed = DesignDocSchema.parse(doc);
    const renderRef = await renderDesign(parsed);
    await db.update(schema.studioDesigns).set({ doc: parsed, renderRef, check: null, updatedAt: new Date() }).where(eq(schema.studioDesigns.id, designId));
    return renderRef;
  }

  async function changeTemplate(projectId: string, direction: number, template: (typeof TEMPLATES)[number]) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) throw new Error("not found");
    const brief = BriefSchema.parse(p.brief);
    const { name: brand } = await brandContext(p.brandId, brief);
    const dir = ((p.directions ?? []) as (Direction & { sceneRef: string; productInScene?: boolean })[])[direction]!;
    const designs = await db.select().from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, direction)));
    for (const des of designs) {
      const next = relayout(DesignDocSchema.parse(des.doc), composeInput(brief, brand, dir, dir.sceneRef, dir.productInScene), { template });
      await db.update(schema.studioDesigns).set({ doc: next, renderRef: await renderDesign(next), check: null, updatedAt: new Date() }).where(eq(schema.studioDesigns.id, des.id));
    }
  }

  /**
   * Launch: one campaign and ad set, one ad per picked direction (its 4:5 design), all PAUSED, with
   * Advantage+ enhancements explicitly off. The new ads' baselines are locked so Keel watches them from the start.
   */
  async function launch(projectId: string, userId: string) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) throw new Error("not found");
    if (p.status === "launched") throw new Error("already launched");
    const brief = BriefSchema.parse(p.brief);
    const dirs = (p.directions ?? []) as Direction[];
    const picked = await db.select().from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.picked, true))).orderBy(asc(schema.studioDesigns.direction));
    const perDirection = [...new Set(picked.map((x) => x.direction))];
    if (!perDirection.length) throw new Error("pick at least one design to launch");
    await db.update(schema.studioProjects).set({ status: "launching", error: null }).where(eq(schema.studioProjects.id, projectId));
    const ads = await d.adsFor(p.accountId);
    const { rulebook } = await brandContext(p.brandId, brief);
    try {
      const [page] = await ads.promotePages(p.accountId);
      if (!page) throw new Error("This ad account has no Facebook Page it can advertise as. Connect a Page in Business settings.");
      const account = await ads.getAccount(p.accountId);
      const minor = ["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD", "IDR"].includes(account.currency ?? "") ? 1 : 100;
      const campaign = await ads.createCampaign(p.accountId, `${p.name} · Keel Studio`);
      const adset = await ads.createAdSet(p.accountId, {
        campaignId: campaign.id, name: `${p.name} · ${brief.countries.join(", ")} ${brief.ageMin}-${brief.ageMax}`,
        dailyBudgetMinor: brief.dailyBudget * minor, countries: brief.countries, ageMin: brief.ageMin, ageMax: brief.ageMax,
        start: new Date(brief.startDate).toISOString(), end: new Date(brief.endDate).toISOString(),
      });
      const made: LaunchedAd[] = [];
      for (const dirIdx of perDirection) {
        const design = picked.find((x) => x.direction === dirIdx && x.size === "portrait") ?? picked.find((x) => x.direction === dirIdx)!;
        made.push(await adFor({ ads, accountId: p.accountId, projectName: p.name, pageId: page.id, adsetId: adset.id, brief, dir: dirs[dirIdx]!, dirIdx, design, locked: lockedFeatures(rulebook), userId }));
      }
      const launch: LaunchInfo = { campaignId: campaign.id, adsetId: adset.id, pageId: page.id, ads: made, at: new Date().toISOString(), currency: account.currency, minor };
      await db.update(schema.studioProjects).set({ status: "launched", launch, updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
      await d.audit(userId, "studio.launched", { projectId, accountId: p.accountId, campaignId: campaign.id, ads: made.map((m) => m.adId) });
      return launch;
    } catch (err) {
      await db.update(schema.studioProjects).set({ status: "ready", error: (err as Error).message.slice(0, 500) }).where(eq(schema.studioProjects.id, projectId));
      await d.audit(userId, "studio.launch_failed", { projectId, accountId: p.accountId, error: (err as Error).message.slice(0, 300) });
      throw err;
    }
  }

  async function create(o: { workspaceId: string; brandId: string; accountId: string; name: string; brief: Brief; userId: string; start?: boolean }) {
    const id = randomUUID();
    await db.insert(schema.studioProjects).values({ id, workspaceId: o.workspaceId, brandId: o.brandId, accountId: o.accountId, name: o.name, brief: o.brief, status: "drafting", steps: STEPS, createdBy: o.userId });
    if (o.start !== false) void run(id);
    return id;
  }

  /** One creative (enhancements locked) and one ad in an existing ad set; its baseline is locked straight away. */
  async function adFor(o: { ads: AdsGraphClient; accountId: string; projectName: string; pageId: string; adsetId: string; brief: Brief; dir: Direction; dirIdx: number;
    design: { id: string; renderRef: string | null }; locked: Record<string, string>; userId: string; active?: boolean }): Promise<LaunchedAd> {
    const { ads, brief, dir } = o;
    const { bytes } = await readMedia(o.design.renderRef!);
    const hash = await ads.uploadImage(o.accountId, bytes, `keel-studio-${o.design.id}.png`);
    const creativeId = await ads.postCreative(o.accountId, {
      name: `${o.projectName} · ${dir.title}`,
      object_story_spec: { page_id: o.pageId, link_data: { link: brief.productUrl, message: dir.primaryText, name: dir.headline, image_hash: hash, call_to_action: { type: dir.cta, value: { link: brief.productUrl } } } },
    }, o.locked);
    const ad = await ads.createAd(o.accountId, { adsetId: o.adsetId, creativeId, name: dir.title, status: o.active ? "ACTIVE" : "PAUSED" });
    // Watched from its first second: what Keel set is the approved baseline.
    const actual = await ads.getFeaturesSpec(creativeId).catch(() => o.locked);
    await db.insert(schema.creativeBaselines).values({ creativeId, adId: ad.id, featuresSpec: actual, lockedBy: o.userId }).onConflictDoNothing();
    return { designId: o.design.id, direction: o.dirIdx, adId: ad.id, creativeId };
  }

  /**
   * A new direction added to an existing project (Autopilot's "make a variant of the winner"): art-directed scene,
   * every size laid out and checked, picked for launch. Returns its index.
   */
  async function addDirection(projectId: string, dir: Direction) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) throw new Error("not found");
    const brief = BriefSchema.parse(p.brief);
    const { name: brand, rulebook } = await brandContext(p.brandId, brief);
    const product = await Promise.all(brief.productPhotos.slice(0, 2).map(imageInput));
    const rows = (p.directions ?? []) as DirRow[];
    const index = rows.length;
    const scene = await artDirect(projectId, dir, brief, product, dir.title);
    const row: DirRow = { ...dir, sceneRef: scene.ref, productInScene: scene.productInScene, ranking: scene.ranking, sceneHistory: [...new Set([...scene.takes, scene.ref])] };
    const template = layoutFor(scene.ranking, "hero");
    for (const size of Object.keys(SIZES) as SizeKey[]) {
      const doc = compose({ ...composeInput(brief, brand, row, row.sceneRef, row.productInScene), template, size });
      await db.insert(schema.studioDesigns).values({ id: randomUUID(), projectId, direction: index, size, doc, renderRef: await renderDesign(doc), picked: true });
    }
    const [sq] = await db.select().from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, index), eq(schema.studioDesigns.size, "square")));
    if (sq?.renderRef) {
      const check = await d.models.critique(await imageInput(sq.renderRef), product[0]!, dir, rulebook).catch(() => null);
      if (check) await db.update(schema.studioDesigns).set({ check }).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, index)));
    }
    const [fresh] = await db.select({ directions: schema.studioProjects.directions }).from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    await db.update(schema.studioProjects).set({ directions: [...((fresh?.directions ?? []) as DirRow[]), row], updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
    await log(projectId, "compose", `New direction "${dir.title}" drawn from what's working`, "decision");
    return index;
  }

  /** Adds one direction's ad to an already-launched campaign's ad set. */
  async function extendLaunch(projectId: string, dirIdx: number, userId: string, active: boolean) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p?.launch) throw new Error("this campaign hasn't launched yet");
    const launch = p.launch as LaunchInfo;
    const brief = BriefSchema.parse(p.brief);
    const { rulebook } = await brandContext(p.brandId, brief);
    const dir = ((p.directions ?? []) as Direction[])[dirIdx];
    const [design] = await db.select().from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, dirIdx), eq(schema.studioDesigns.size, "portrait")));
    if (!dir || !design) throw new Error("no such direction");
    const ads = await d.adsFor(p.accountId);
    const made = await adFor({ ads, accountId: p.accountId, projectName: p.name, pageId: launch.pageId, adsetId: launch.adsetId, brief, dir, dirIdx, design, locked: lockedFeatures(rulebook), userId, active });
    const next: LaunchInfo = { ...launch, ads: [...launch.ads, made] };
    await db.update(schema.studioProjects).set({ launch: next, updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
    await d.audit(userId, "studio.ad_added", { projectId, accountId: p.accountId, adId: made.adId, direction: dirIdx });
    return made;
  }

  async function list(workspaceIds: string[]) {
    if (!workspaceIds.length) return [];
    const projects = await db.select().from(schema.studioProjects).where(inArray(schema.studioProjects.workspaceId, workspaceIds)).orderBy(desc(schema.studioProjects.createdAt)).limit(100);
    const covers = projects.length ? await db.select({ projectId: schema.studioDesigns.projectId, renderRef: schema.studioDesigns.renderRef, direction: schema.studioDesigns.direction, size: schema.studioDesigns.size })
      .from(schema.studioDesigns).where(and(inArray(schema.studioDesigns.projectId, projects.map((p) => p.id)), eq(schema.studioDesigns.size, "square"))) : [];
    return projects.map((p) => ({ ...p, covers: covers.filter((c) => c.projectId === p.id).sort((a, b) => a.direction - b.direction).map((c) => c.renderRef) }));
  }

  return { create, run, list, regenerateScene, useScene, saveDesign, changeTemplate, launch, renderDesign, drawStoryboard, addDirection, extendLaunch };
}
export type Studio = ReturnType<typeof createStudio>;
