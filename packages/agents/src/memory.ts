import { eq } from "drizzle-orm";
import type { AdAnalysis, BrandMemory } from "@keel/core";
import { schema, type Db } from "@keel/db";
import { captureRemote, inlineImageHref, type AdsGraphClient } from "@keel/meta";
import type { StudioModels } from "./studio/models.ts";

export interface MemoryAd { adId: string; name: string; imageRef?: string; body?: string; title?: string; impressions: number; ctr: number; cpc: number; spend: number; purchases?: number; cpa?: number; roas?: number; analysis?: AdAnalysis }
export interface MemoryLearning { at: string; text: string; source: string }
export interface MemoryRow { brandId: string; summary: BrandMemory | null; ads: MemoryAd[]; learnings: MemoryLearning[]; updatedAt: Date }

const MIN_IMPRESSIONS = 500;

/**
 * Brand memory: what has worked for this brand. Muse Spark reads the brand's own past ads (the ones with real delivery), Muse Wonder
 * finds what the winners share, and every Autopilot learning is added. Studio and Autopilot read it before planning anything.
 */
export function createMemory(d: { db: Db; models: StudioModels; adsFor(accountId: string): Promise<AdsGraphClient>; audit(actor: string, event: string, payload: unknown): Promise<void> }) {
  const { db } = d;

  async function get(brandId: string): Promise<MemoryRow | undefined> {
    const [r] = await db.select().from(schema.brandMemory).where(eq(schema.brandMemory.brandId, brandId));
    return r ? { brandId, summary: (r.summary as BrandMemory | null) ?? null, ads: (r.ads ?? []) as MemoryAd[], learnings: (r.learnings ?? []) as MemoryLearning[], updatedAt: r.updatedAt } : undefined;
  }

  async function save(brandId: string, patch: { summary?: BrandMemory; ads?: MemoryAd[]; learnings?: MemoryLearning[] }) {
    await db.insert(schema.brandMemory).values({ brandId, ...patch, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.brandMemory.brandId, set: { ...patch, updatedAt: new Date() } });
  }

  /** Reads the account's past ads and rebuilds the brand's memory. */
  async function refresh(brandId: string, userId: string) {
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
    const accounts = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.brandId, brandId));
    const ads: MemoryAd[] = [];
    for (const a of accounts) {
      const client = await d.adsFor(a.metaAccountId);
      const top = (await client.topAds(a.metaAccountId, 25).catch(() => [])).filter((x) => x.impressions >= MIN_IMPRESSIONS).slice(0, 16);
      const read = await Promise.all(top.map(async (t) => {
        const c = await client.adCreative(t.adId).catch(() => ({ image: undefined, body: undefined, title: undefined }));
        const imageRef = c.image ? await captureRemote(c.image, "memory") : undefined;
        const analysis = await d.models.analyzeAd({ image: imageRef?.startsWith("file://") ? { dataUrl: await inlineImageHref(imageRef) } : undefined, body: c.body, title: c.title, pageName: brand?.name ?? "our brand" }).catch(() => undefined);
        return { ...t, name: t.adName, imageRef: imageRef?.startsWith("file://") ? imageRef : undefined, body: c.body, title: c.title, analysis } satisfies MemoryAd;
      }));
      ads.push(...read);
    }
    const prev = await get(brandId);
    const learnings = prev?.learnings ?? [];
    if (!ads.length && !learnings.length) {
      await save(brandId, { ads: [], summary: { summary: "No past ads with enough delivery yet. Memory fills in as campaigns run.", winners: [], losers: [], doMore: [], avoid: [] } });
      return get(brandId);
    }
    const summary = await d.models.learnMemory({ brand: brand?.name ?? "the brand", ads, learnings: learnings.map((l) => l.text) });
    await save(brandId, { ads, summary });
    await d.audit(userId, "memory.refreshed", { brandId, ads: ads.length, learnings: learnings.length });
    return get(brandId);
  }

  /** Adds what a live campaign taught (Autopilot learnings) to the brand's memory. */
  async function remember(brandId: string, texts: string[], source: string) {
    if (!texts.length) return;
    const prev = await get(brandId);
    const at = new Date().toISOString();
    const learnings = [...(prev?.learnings ?? []), ...texts.map((text) => ({ at, text, source }))].slice(-60);
    await save(brandId, { learnings, ads: prev?.ads ?? [], summary: prev?.summary ?? undefined });
  }

  return { get, refresh, remember };
}
export type Memory = ReturnType<typeof createMemory>;
