import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  BriefSchema, DesignDocSchema, RulebookSchema, SIZES, TEMPLATES, compose, designToSvg, relayout,
  type Brief, type DesignDoc, type Direction, type Research, type Rulebook, type SizeKey, type TemplateKey,
} from "@keel/core";
import { schema, type Db } from "@keel/db";
import { type AdsGraphClient, inlineImageHref, readMedia, renderSvgToPng, saveMedia } from "@keel/meta";
import { FORMAT_LABEL, FORMAT_SCENES, FORMATS, FormatCopySchema, STYLE_LABEL, type Concept, type DesignInfo, type FormatKey, type VisualStyle } from "@keel/core";
import type { Memory } from "../memory.ts";
import { designAd, refineDesign, resizeDesign } from "./art.ts";
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
type DirRow = Direction & { design?: DesignInfo; sceneRef: string; sceneRef2?: string; sceneHistory: string[]; productInScene?: boolean; ranking?: SceneRanking; frames?: (string | null)[] };
const hostOf = (u?: string) => { try { return new URL(u ?? "").host.replace(/^www\./, ""); } catch { return ""; } };
/** Customer quotes that are reviews of this brand's own product (from its own site), the only ones a testimonial may use. */
function ownQuotes(brief: Brief, research: Research | null) {
  const own = hostOf(brief.productUrl);
  return (research?.voice?.quotes ?? []).filter((q) => own && hostOf(q.url) === own);
}

const ASPECT = { square: "1:1", portrait: "4:5", story: "9:16" } as const;
const ART_ENGINE = () => process.env.STUDIO_ART_ENGINE !== "0";

/** A design Muse Image made whole: one full-bleed image layer (edited with Refine, not layer by layer). */
function generatedDoc(ref: string, size: SizeKey, fit: "cover" | "contain" = "cover", base = "#000000"): DesignDoc {
  const { w, h } = SIZES[size];
  return { w, h, size, template: "hero", layers: [
    ...(fit === "contain" ? [{ id: "bg", kind: "rect" as const, role: "panel" as const, x: 0, y: 0, w, h, fill: base, angle: 180, radius: 0, opacity: 1, shadow: false, locked: true }] : []),
    { id: "design", kind: "image", role: "scene", ref, x: 0, y: 0, w, h, fit, radius: 0, shadow: false, opacity: 1, locked: true },
  ] };
}
const isGenerated = (doc: DesignDoc) => doc.layers.some((l) => l.id === "design" && l.kind === "image");

export interface ConceptBoard { status: "making" | "ready" | "failed"; items: Concept[]; error?: string; at: string }

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
  memory?: Memory;
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

  function composeInput(brief: Brief, brand: string, direction: Direction, sceneRef: string, productInScene = false, sceneRef2?: string) {
    return { sceneRef, sceneRef2, productRef: brief.productPhotos[0]!, brand, direction, price: brief.price || undefined, offer: brief.offer || undefined, productInScene, logoRef: brief.logoRef };
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
        const memory = (await d.memory?.get(p.brandId))?.summary ?? undefined;
        if (memory?.winners.length) await log(projectId, "strategy", `Using what's worked for ${brand} before: ${memory.winners[0]}`, "decision");
        const ds = (await d.models.planDirections(brief, brand, product, rulebook, research.ads.length ? research.insights : undefined, { voice: research.voice, memory })).slice(0, 3);
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
    if (dir.design?.mode === "generated") {
      // A whole Muse Image design: design it again and re-lay every size.
      const r = await designAd({ models: d.models, c: dir, brief, brand, aspect: "1:1", logoRef: brief.logoRef, style: dir.design.style, log: (t, k) => log(projectId, "compose", t, k) });
      dirs[direction] = { ...dir, ...(r.mode === "art" ? { format: "classic" as const } : {}), design: r.info, sceneRef: r.ref, sceneHistory: [...(dir.sceneHistory ?? []), r.ref].slice(-8) };
      await db.update(schema.studioProjects).set({ directions: dirs, updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
      for (const des of await db.select().from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, direction)))) {
        const doc = await docFor(dirs[direction]!, brief, brand, des.size as SizeKey);
        await db.update(schema.studioDesigns).set({ doc, renderRef: await renderDesign(doc), check: null, updatedAt: new Date() }).where(eq(schema.studioDesigns.id, des.id));
      }
      if (audit) await d.audit(p.createdBy, "studio.scene_regenerated", { projectId, direction });
      return r.ref;
    }
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
    const dir = ((p.directions ?? []) as DirRow[])[direction]!;
    if (dir.design?.mode === "generated") throw new Error("Muse Image designed this one whole, so it has no template. Use Refine to change it.");
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
      let pixelId: string | undefined;
      if (brief.objective === "sales") {
        pixelId = (await ads.pixels(p.accountId).catch(() => []))[0]?.id;
        if (!pixelId) throw new Error("A sales campaign needs a Meta Pixel on this ad account. Add one in Events Manager, or choose website visits.");
      }
      const campaign = await ads.createCampaign(p.accountId, `${p.name} · Keel Studio`, brief.objective);
      const adset = await ads.createAdSet(p.accountId, {
        campaignId: campaign.id, name: `${p.name} · ${brief.countries.join(", ")} ${brief.ageMin}-${brief.ageMax}`,
        dailyBudgetMinor: brief.dailyBudget * minor, countries: brief.countries, ageMin: brief.ageMin, ageMax: brief.ageMax,
        start: new Date(brief.startDate).toISOString(), end: new Date(brief.endDate).toISOString(), pixelId,
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

  // ── Concept board ────────────────────────────────────────────────────────

  async function setBoard(projectId: string, fn: (b: ConceptBoard) => ConceptBoard) {
    const [p] = await db.select({ concepts: schema.studioProjects.concepts }).from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    const cur = (p?.concepts as ConceptBoard | null) ?? { status: "ready", items: [], at: new Date().toISOString() };
    const next = fn(cur);
    await db.update(schema.studioProjects).set({ concepts: next, updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
    return next;
  }

  /** Keeps concepts honest: real quotes only, offers only if the brief has one, no named competitors in comparisons. */
  function vet(c: Direction, brief: Brief, research: Research | null): Direction & { format: FormatKey } {
    const copy = FormatCopySchema.parse(c.copy ?? {});
    let format = (FORMATS as readonly string[]).includes(c.format ?? "") ? (c.format as FormatKey) : "classic";
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
    if (format === "testimonial") {
      // A testimonial must be a real review of THIS product: quotes about competitors or the category are never ours to show.
      const real = ownQuotes(brief, research).find((q) => copy.quote.length >= 20 && (norm(q.text).includes(norm(copy.quote)) || norm(copy.quote).includes(norm(q.text))));
      if (real) copy.author = copy.author || real.source;
      else { format = "tweet"; copy.quote = c.primaryText; copy.author = ""; }
    }
    if (format === "offer" && !brief.offer) format = "classic";
    if (format === "versus") {
      const names = [...(research?.competitors ?? []), ...brief.competitors].map(norm).filter((n) => n.length > 2);
      if (!copy.them || names.some((n) => norm(copy.them).includes(n))) copy.them = "Others";
      if (!copy.rows.length) format = "notes";
    }
    if (format === "notes" && !copy.lines.length) copy.lines = [c.subline, c.hook].filter(Boolean);
    return { ...c, format, copy };
  }

  async function renderConcept(c: Direction & { format: FormatKey }, brief: Brief, brand: string, product: { dataUrl: string }[], projectId: string, style?: VisualStyle) {
    if (ART_ENGINE()) {
      const r = await designAd({ models: d.models, c, brief, brand, aspect: "1:1", logoRef: brief.logoRef, style: style ?? c.style, log: (t, k) => log(projectId, "compose", t, k) });
      const doc = r.mode === "generated" ? generatedDoc(r.ref, "square") : compose({ ...composeInput(brief, brand, { ...c, format: "classic" }, r.ref, true), template: "hero", size: "square" });
      const renderRef = await renderDesign(doc);
      const score = await d.models.scoreConcept(await imageInput(renderRef), product[0]!, c).catch(() => undefined);
      return { sceneRef: r.ref, sceneRef2: undefined, productInScene: true, renderRef, score, design: r.info, style: r.info.style };
    }
    const n = FORMAT_SCENES[c.format];
    let sceneRef = brief.productPhotos[0]!, sceneRef2: string | undefined, productInScene = false;
    if (n >= 1) {
      const withProduct = c.format !== "meme";
      const shot = await d.models.generateScene(c, brief, withProduct ? product : [], 0);
      sceneRef = await saveMedia(shot.bytes, ".png", "scenes");
      productInScene = shot.productInScene;
    }
    if (n >= 2) sceneRef2 = await saveMedia((await d.models.generateScene({ ...c, scenePrompt: c.copy?.scene2 || c.scenePrompt }, brief, [], 1)).bytes, ".png", "scenes");
    const doc = compose({ ...composeInput(brief, brand, c, sceneRef, productInScene, sceneRef2), template: "hero", size: "square" });
    const renderRef = await renderDesign(doc);
    const score = await d.models.scoreConcept(await imageInput(renderRef), product[0]!, c).catch(() => undefined);
    return { sceneRef, sceneRef2, productInScene, renderRef, score, design: undefined, style: c.style };
  }

  /** The doc for one size of a concept or direction: Muse Image's own design re-laid for that shape, or live type over its artwork. */
  async function docFor(row: DirRow, brief: Brief, brand: string, size: SizeKey): Promise<DesignDoc> {
    if (row.design?.mode === "generated") {
      if (size === "square") return generatedDoc(row.sceneRef, size);
      try {
        const r = await resizeDesign({ models: d.models, c: row, brief, fromRef: row.sceneRef, aspect: ASPECT[size] });
        if (r.ok) return generatedDoc(r.ref, size);
      } catch { /* fall back below */ }
      return generatedDoc(row.sceneRef, size, "contain", row.palette.base);
    }
    return compose({ ...composeInput(brief, brand, row, row.sceneRef, row.productInScene, row.sceneRef2), template: "hero", size });
  }

  /**
   * Refine: one precise Muse Image edit on a design ("warmer light", "move the product left"). A Muse Image design is edited whole and its words
   * re-checked; a layout design has its artwork edited and the live type kept.
   */
  async function refine(designId: string, instruction: string, userId: string) {
    const [des] = await db.select().from(schema.studioDesigns).where(eq(schema.studioDesigns.id, designId));
    if (!des) throw new Error("not found");
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, des.projectId));
    const brief = BriefSchema.parse(p!.brief);
    const row = ((p!.directions ?? []) as DirRow[])[des.direction];
    if (!row) throw new Error("no such direction");
    const doc = DesignDocSchema.parse(des.doc);
    const generated = isGenerated(doc);
    const target = doc.layers.find((l) => l.kind === "image" && (l.id === "design" || l.role === "scene")) as { ref: string } | undefined;
    if (!target) throw new Error("this design has no artwork to refine");
    const r = await refineDesign({ models: d.models, c: row, brief, fromRef: target.ref, aspect: ASPECT[des.size as SizeKey], instruction, generated });
    if (!r.ok) throw new Error(`Muse Image changed the text (${r.check?.texts.find((t) => !t.exact)?.found ?? "spelling"}), so the refine wasn't applied. Try a narrower instruction.`);
    const next = { ...doc, layers: doc.layers.map((l) => (l.kind === "image" && (l.id === "design" || l.role === "scene") ? { ...l, ref: r.ref } : l)) };
    const renderRef = await renderDesign(next);
    await db.update(schema.studioDesigns).set({ doc: next, renderRef, check: null, updatedAt: new Date() }).where(eq(schema.studioDesigns.id, designId));
    await log(des.projectId, "compose", `Refined ${row.title} (${des.size}): ${instruction.slice(0, 120)}`, "decision");
    await d.audit(userId, "studio.design_refined", { projectId: des.projectId, designId, instruction: instruction.slice(0, 200) });
    return renderRef;
  }

  /** Refine a concept on the board before it joins the campaign. */
  async function refineConcept(projectId: string, conceptId: string, instruction: string, userId: string) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) throw new Error("not found");
    const brief = BriefSchema.parse(p.brief);
    const { name: brand } = await brandContext(p.brandId, brief);
    const c = ((p.concepts as ConceptBoard | null)?.items ?? []).find((x) => x.id === conceptId);
    if (!c?.sceneRef) throw new Error("no such concept");
    const generated = c.design?.mode === "generated";
    const r = await refineDesign({ models: d.models, c, brief, fromRef: c.sceneRef, aspect: "1:1", instruction, generated });
    if (!r.ok) throw new Error("Muse Image changed the text, so the refine wasn't applied. Try a narrower instruction.");
    const doc = generated ? generatedDoc(r.ref, "square") : compose({ ...composeInput(brief, brand, { ...c, format: c.design ? "classic" : c.format }, r.ref, true, c.sceneRef2), template: "hero", size: "square" });
    const renderRef = await renderDesign(doc);
    await setBoard(projectId, (b) => ({ ...b, items: b.items.map((x) => (x.id === conceptId ? { ...x, sceneRef: r.ref, renderRef, history: [...(x.history ?? []), x.renderRef!].filter(Boolean).slice(-6) } : x)) }));
    await d.audit(userId, "studio.concept_refined", { projectId, conceptId, instruction: instruction.slice(0, 200) });
    return renderRef;
  }

  /**
   * The concept board: Muse Wonder writes many ideas across formats (from research, customer voice and brand memory), each is rendered
   * and Muse Spark scores it as a pre-flight check. The best three are recommended; a person picks what goes into the campaign.
   * With `remixOf`, Wonder rebuilds the structure of one long-running competitor ad for this brand instead.
   */
  async function makeConcepts(projectId: string, o: { count?: number; formats?: FormatKey[]; remixOf?: string; style?: VisualStyle } = {}) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) throw new Error("not found");
    const brief = BriefSchema.parse(p.brief);
    const { name: brand, rulebook } = await brandContext(p.brandId, brief);
    const research = p.research as Research | null;
    const product = await Promise.all(brief.productPhotos.slice(0, 2).map(imageInput));
    const count = Math.max(1, Math.min(16, o.count ?? Number(process.env.STUDIO_CONCEPTS ?? 12)));
    const formats = (o.formats?.length ? o.formats : FORMATS.filter((f) => (f !== "offer" || brief.offer) && (f !== "testimonial" || ownQuotes(brief, research).length > 0))) as FormatKey[];
    const remixAd = o.remixOf ? research?.ads.find((a) => a.id === o.remixOf) : undefined;
    if (o.remixOf && !remixAd) throw new Error("that competitor ad isn't in this campaign's research");
    await setBoard(projectId, (b) => ({ ...b, status: "making", error: undefined, at: new Date().toISOString() }));
    try {
      const memory = (await d.memory?.get(p.brandId))?.summary ?? undefined;
      await log(projectId, "compose", remixAd ? `Remixing the structure of ${remixAd.pageName}'s ad for ${brand}` : `Writing ${count} concepts across ${formats.length} formats`, "decision");
      const voice = research?.voice ? { ...research.voice, quotes: ownQuotes(brief, research) } : undefined;
      const planned = (await d.models.planConcepts({ brief, brand, product, insights: research?.insights, voice, memory, rulebook, count: remixAd ? 1 : count, formats,
        remix: remixAd ? { image: remixAd.snapshotRef ? await imageInput(remixAd.snapshotRef) : undefined, analysis: remixAd.analysis, pageName: remixAd.pageName } : undefined })).slice(0, remixAd ? 1 : count);
      const made: Concept[] = [];
      const queue = planned.map((c) => vet(c, brief, research));
      let next = 0;
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (next < queue.length) {
          const c = queue[next++]!;
          try {
            const r = await renderConcept(c, brief, brand, product, projectId, o.style);
            made.push({ ...c, ...r, id: randomUUID(), createdAt: new Date().toISOString(), ...(remixAd ? { remixOf: { adId: remixAd.id, pageName: remixAd.pageName } } : {}) });
          } catch (err) {
            await log(projectId, "compose", `${c.title}: couldn't render (${(err as Error).message.slice(0, 80)})`, "warn");
          }
        }
      }));
      const board = await setBoard(projectId, (b) => {
        const items = [...b.items, ...made].sort((x, y) => (y.score?.overall ?? 0) - (x.score?.overall ?? 0)).map((x, k) => ({ ...x, recommended: k < 3 && x.addedAs === undefined }));
        return { status: "ready", items, at: new Date().toISOString() };
      });
      const top = board.items.filter((x) => x.recommended);
      const gen = made.filter((x) => x.design?.mode === "generated").length;
      await log(projectId, "check", `Muse Spark pre-scored ${made.length} concepts${ART_ENGINE() ? ` (${gen} designed whole by Muse Image, ${made.length - gen} with Keel's type over its artwork)` : ""}. Strongest: ${top.map((x) => `${x.title} (${FORMAT_LABEL[x.format]}${x.style ? `, ${STYLE_LABEL[x.style]}` : ""}, ${Math.round((x.score?.overall ?? 0) * 100)})`).join(", ")}`, "decision");
      return made.length;
    } catch (err) {
      await setBoard(projectId, (b) => ({ ...b, status: "failed", error: (err as Error).message.slice(0, 300), at: new Date().toISOString() }));
      throw err;
    }
  }

  /** Turns picked concepts into campaign directions (every size laid out, picked for launch). If the campaign is live, adds them as ads. */
  async function addConcepts(projectId: string, conceptIds: string[], userId: string) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) throw new Error("not found");
    const brief = BriefSchema.parse(p.brief);
    const { name: brand } = await brandContext(p.brandId, brief);
    const board = (p.concepts as ConceptBoard | null) ?? { status: "ready", items: [], at: "" };
    const picks = board.items.filter((c) => conceptIds.includes(c.id) && c.addedAs === undefined);
    const rows = (p.directions ?? []) as DirRow[];
    const added: { id: string; index: number }[] = [];
    for (const c of picks) {
      const index = rows.length;
      const { id: _id, renderRef: _r, score: _s, recommended: _rec, addedAs: _a, remixOf: _rm, createdAt: _c, history: _h, sceneRef, sceneRef2, productInScene, design, ...dir } = c;
      // Live type over Muse Image's artwork uses the hero layout; a whole Muse Image design keeps its own.
      const row: DirRow = { ...dir, ...(design?.mode === "art" ? { format: "classic" as const } : {}), design, sceneRef: sceneRef ?? brief.productPhotos[0]!, sceneRef2, productInScene, sceneHistory: sceneRef ? [sceneRef] : [] };
      rows.push(row);
      for (const size of Object.keys(SIZES) as SizeKey[]) {
        const doc = await docFor(row, brief, brand, size);
        await db.insert(schema.studioDesigns).values({ id: randomUUID(), projectId, direction: index, size, doc, renderRef: await renderDesign(doc), picked: true, check: c.score ? { pass: c.score.overall >= 0.5, score: c.score.overall, issues: c.score.notes ? [c.score.notes] : [] } : null });
      }
      added.push({ id: c.id, index });
    }
    await db.update(schema.studioProjects).set({ directions: rows, updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
    await setBoard(projectId, (b) => ({ ...b, items: b.items.map((x) => { const a = added.find((y) => y.id === x.id); return a ? { ...x, addedAs: a.index, recommended: false } : x; }) }));
    await d.audit(userId, "studio.concepts_added", { projectId, concepts: added.length });
    if (p.launch && p.status === "launched") {
      for (const a of added) await extendLaunch(projectId, a.index, userId, !!(p.launch as LaunchInfo).active);
    }
    return added;
  }

  return { create, run, list, regenerateScene, useScene, saveDesign, changeTemplate, launch, renderDesign, drawStoryboard, addDirection, extendLaunch, makeConcepts, addConcepts, refine, refineConcept };
}
export type Studio = ReturnType<typeof createStudio>;
