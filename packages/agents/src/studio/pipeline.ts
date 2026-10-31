import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  BriefSchema, DesignDocSchema, RulebookSchema, SIZES, TEMPLATES, compose, designToSvg, relayout,
  type Brief, type DesignDoc, type Direction, type Rulebook, type SizeKey,
} from "@keel/core";
import { schema, type Db } from "@keel/db";
import { type AdsGraphClient, inlineImageHref, readMedia, renderSvgToPng, saveMedia } from "@keel/meta";
import type { StudioModels } from "./models.ts";

export type StepKey = "plan" | "scenes" | "compose" | "check";
export interface Step { key: StepKey; label: string; status: "waiting" | "running" | "done" | "failed"; detail?: string; ms?: number }
const STEPS: Step[] = [
  { key: "plan", label: "Plan three creative directions", status: "waiting" },
  { key: "scenes", label: "Generate a scene for each", status: "waiting" },
  { key: "compose", label: "Lay out every size with your real product", status: "waiting" },
  { key: "check", label: "Check each design before you see it", status: "waiting" },
];

/** The features Studio switches off on new creatives, plus any the rulebook locks. Meta's own defaults are never trusted. */
export const STUDIO_LOCKED_FEATURES = [
  "image_touchups", "image_templates", "image_uncrop", "image_background_gen", "text_optimizations", "text_generation", "inline_comment",
  "enhance_cta", "music", "image_animation", "add_text_overlay", "description_automation", "image_brightness_and_contrast", "adapt_to_placement",
  "site_extensions", "product_extensions", "pac_recomposition", "video_auto_crop",
];

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

  async function brandContext(brandId: string): Promise<{ name: string; rulebook?: Rulebook }> {
    const [b] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
    const [rb] = await db.select().from(schema.rulebooks).where(eq(schema.rulebooks.brandId, brandId)).orderBy(desc(schema.rulebooks.version)).limit(1);
    const parsed = rb ? RulebookSchema.safeParse(rb.rules) : undefined;
    return { name: b?.name ?? "Brand", rulebook: parsed?.success ? parsed.data : undefined };
  }

  async function renderDesign(doc: DesignDoc): Promise<string> {
    const refs = [...new Set(doc.layers.filter((l) => l.kind === "image").map((l) => (l as { ref: string }).ref))];
    const map = new Map(await Promise.all(refs.map(async (r) => [r, await inlineImageHref(r)] as const)));
    const png = await renderSvgToPng(designToSvg(doc, (r) => map.get(r) ?? r), doc.w, doc.h);
    return saveMedia(png, ".png", "studio");
  }

  function composeInput(brief: Brief, brand: string, direction: Direction, sceneRef: string, productInScene = false) {
    return { sceneRef, productRef: brief.productPhotos[0]!, brand, direction, price: brief.price || undefined, offer: brief.offer || undefined, productInScene };
  }

  /** The agent run: plan → scenes → layouts → self-check (regenerating a direction's scene once if it fails). */
  async function run(projectId: string) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) return;
    const brief = BriefSchema.parse(p.brief);
    const { name: brand, rulebook } = await brandContext(p.brandId);
    const product = await Promise.all(brief.productPhotos.slice(0, 3).map(imageInput));
    try {
      const directions = await timed(projectId, "plan", async () => {
        const ds = (await d.models.planDirections(brief, brand, product, rulebook)).slice(0, 3);
        if (!ds.length) throw new Error("no directions came back");
        return { value: ds, detail: ds.map((x) => x.title).join(" · ") };
      });
      const scenes = await timed(projectId, "scenes", async () => {
        const made = await Promise.all(directions.map(async (dir) => {
          const r = await d.models.generateScene(dir, brief, product);
          return { ref: await saveMedia(r.bytes, ".png", "scenes"), productInScene: r.productInScene };
        }));
        return { value: made, detail: `${made.length} scenes${made.every((m) => m.productInScene) ? ", your product placed in each" : ""}` };
      });
      await db.update(schema.studioProjects).set({ directions: directions.map((dir, i) => ({ ...dir, sceneRef: scenes[i]!.ref, productInScene: scenes[i]!.productInScene, sceneHistory: [scenes[i]!.ref] })) }).where(eq(schema.studioProjects.id, projectId));

      await timed(projectId, "compose", async () => {
        await db.delete(schema.studioDesigns).where(eq(schema.studioDesigns.projectId, projectId));
        let n = 0;
        for (const [i, dir] of directions.entries()) {
          for (const size of Object.keys(SIZES) as SizeKey[]) {
            const doc = compose({ ...composeInput(brief, brand, dir, scenes[i]!.ref, scenes[i]!.productInScene), template: TEMPLATES[i % TEMPLATES.length]!, size });
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
            // One retry: new scene for this direction, re-laid out in every size.
            await regenerateScene(projectId, i, false);
            const [again] = await db.select().from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, i), eq(schema.studioDesigns.size, "square")));
            check = await d.models.critique(await imageInput(again!.renderRef!), await imageInput(productRef), dir, rulebook);
            fixed++;
          }
          if (check.pass) passed++;
          await db.update(schema.studioDesigns).set({ check }).where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.direction, i)));
        }
        return { value: passed, detail: `${passed} of ${directions.length} ready${fixed ? ` · ${fixed} regenerated` : ""}` };
      });
      await db.update(schema.studioProjects).set({ status: "ready", updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
      await d.audit(p.createdBy, "studio.drafted", { projectId, accountId: p.accountId, directions: directions.length });
    } catch (err) {
      await db.update(schema.studioProjects).set({ status: "failed", error: (err as Error).message.slice(0, 500), updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
    }
  }

  async function regenerateScene(projectId: string, direction: number, audit = true) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId));
    if (!p) throw new Error("not found");
    const brief = BriefSchema.parse(p.brief);
    const { name: brand } = await brandContext(p.brandId);
    const dirs = (p.directions ?? []) as (Direction & { sceneRef: string; sceneHistory: string[]; productInScene?: boolean })[];
    const dir = dirs[direction];
    if (!dir) throw new Error("no such direction");
    const product = await Promise.all(brief.productPhotos.slice(0, 2).map(imageInput));
    const scene = await d.models.generateScene(dir, brief, product);
    const sceneRef = await saveMedia(scene.bytes, ".png", "scenes");
    dirs[direction] = { ...dir, sceneRef, productInScene: scene.productInScene, sceneHistory: [...(dir.sceneHistory ?? []), sceneRef].slice(-6) };
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
    const { name: brand } = await brandContext(p.brandId);
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
    const { rulebook } = await brandContext(p.brandId);
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
      const locked = Object.fromEntries([...new Set([...STUDIO_LOCKED_FEATURES, ...(rulebook?.lockedEnhancements ?? [])])].map((k) => [k, "OPT_OUT"]));
      const made: { designId: string; direction: number; adId: string; creativeId: string }[] = [];
      for (const dirIdx of perDirection) {
        const design = picked.find((x) => x.direction === dirIdx && x.size === "portrait") ?? picked.find((x) => x.direction === dirIdx)!;
        const dir = dirs[dirIdx]!;
        const { bytes } = await readMedia(design.renderRef!);
        const hash = await ads.uploadImage(p.accountId, bytes, `keel-studio-${design.id}.png`);
        const creativeId = await ads.postCreative(p.accountId, {
          name: `${p.name} · ${dir.title}`,
          object_story_spec: { page_id: page.id, link_data: { link: brief.productUrl, message: dir.primaryText, name: dir.headline, image_hash: hash, call_to_action: { type: dir.cta, value: { link: brief.productUrl } } } },
        }, locked);
        const ad = await ads.createAd(p.accountId, { adsetId: adset.id, creativeId, name: `${dir.title}` });
        made.push({ designId: design.id, direction: dirIdx, adId: ad.id, creativeId });
        // Watched from its first second: what Keel set is the approved baseline.
        const actual = await ads.getFeaturesSpec(creativeId).catch(() => locked);
        await db.insert(schema.creativeBaselines).values({ creativeId, adId: ad.id, featuresSpec: actual, lockedBy: userId }).onConflictDoNothing();
      }
      const launch = { campaignId: campaign.id, adsetId: adset.id, pageId: page.id, ads: made, at: new Date().toISOString() };
      await db.update(schema.studioProjects).set({ status: "launched", launch, updatedAt: new Date() }).where(eq(schema.studioProjects.id, projectId));
      await d.audit(userId, "studio.launched", { projectId, accountId: p.accountId, campaignId: campaign.id, ads: made.map((m) => m.adId) });
      return launch;
    } catch (err) {
      await db.update(schema.studioProjects).set({ status: "ready", error: (err as Error).message.slice(0, 500) }).where(eq(schema.studioProjects.id, projectId));
      await d.audit(userId, "studio.launch_failed", { projectId, accountId: p.accountId, error: (err as Error).message.slice(0, 300) });
      throw err;
    }
  }

  async function create(o: { workspaceId: string; brandId: string; accountId: string; name: string; brief: Brief; userId: string }) {
    const id = randomUUID();
    await db.insert(schema.studioProjects).values({ id, workspaceId: o.workspaceId, brandId: o.brandId, accountId: o.accountId, name: o.name, brief: o.brief, status: "drafting", steps: STEPS, createdBy: o.userId });
    void run(id);
    return id;
  }

  async function list(workspaceIds: string[]) {
    if (!workspaceIds.length) return [];
    const projects = await db.select().from(schema.studioProjects).where(inArray(schema.studioProjects.workspaceId, workspaceIds)).orderBy(desc(schema.studioProjects.createdAt)).limit(100);
    const covers = projects.length ? await db.select({ projectId: schema.studioDesigns.projectId, renderRef: schema.studioDesigns.renderRef, direction: schema.studioDesigns.direction, size: schema.studioDesigns.size })
      .from(schema.studioDesigns).where(and(inArray(schema.studioDesigns.projectId, projects.map((p) => p.id)), eq(schema.studioDesigns.size, "square"))) : [];
    return projects.map((p) => ({ ...p, covers: covers.filter((c) => c.projectId === p.id).sort((a, b) => a.direction - b.direction).map((c) => c.renderRef) }));
  }

  return { create, run, list, regenerateScene, useScene, saveDesign, changeTemplate, launch, renderDesign };
}
export type Studio = ReturnType<typeof createStudio>;
