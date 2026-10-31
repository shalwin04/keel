import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Variant } from "@keel/core";
import type { AdsGraphClient } from "./ads.ts";
import { REPO_ROOT } from "./config.ts";
import { saveMedia } from "./media.ts";

/** Where rendered variants come from. Pluggable so the demo never depends on one API surface. */
export interface VariantSource {
  readonly name: string;
  listVariants(adId: string): Promise<Variant[]>;
  close?(): Promise<void>;
}

export const DEFAULT_PLACEMENTS = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_STORY"];

/** The iframe URL inside a Marketing API preview body. */
export function previewIframeSrc(body: string): string | undefined {
  const m = body.match(/src=["']([^"']+)["']/i);
  return m?.[1]?.replaceAll("&amp;", "&");
}

type Browser = { newPage(o?: object): Promise<Page>; close(): Promise<void> };
type Page = {
  goto(url: string, o?: object): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(o?: object): Promise<Buffer>;
  close(): Promise<void>;
};

/**
 * Marketing API ad previews, rendered to PNG with headless Chromium (Playwright) so the judges see
 * what a person in that placement sees. Playwright is loaded lazily; without it this source is empty.
 */
export class MetaPreviewSource implements VariantSource {
  readonly name = "meta_preview";
  private browser?: Promise<Browser | undefined>;
  constructor(private ads: AdsGraphClient, private placements = (process.env.PREVIEW_PLACEMENTS?.split(",") ?? DEFAULT_PLACEMENTS)) {}

  private launch() {
    return (this.browser ??= (async () => {
      try {
        const pw = (await import(/* @vite-ignore */ "playwright" as string)) as { chromium: { launch(o?: object): Promise<Browser> } };
        return await pw.chromium.launch({ args: ["--no-sandbox"] });
      } catch (err) {
        console.warn(`[keel] preview rendering unavailable (${(err as Error).message.split("\n")[0]})`);
        return undefined;
      }
    })());
  }

  async listVariants(adId: string): Promise<Variant[]> {
    const browser = await this.launch();
    if (!browser) return [];
    const out: Variant[] = [];
    for (const placement of this.placements) {
      try {
        const { data } = await this.ads.getPreviews(adId, placement);
        for (const [i, d] of data.entries()) {
          const src = previewIframeSrc(d.body);
          if (!src) continue;
          const page = await browser.newPage({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
          try {
            await page.goto(src, { waitUntil: "networkidle", timeout: 20_000 });
            await page.waitForTimeout(600);
            const ref = await saveMedia(await page.screenshot({ fullPage: true }), ".png", "previews");
            out.push({ id: `${adId}:${placement}:${i}`, adId, placement, imageRef: ref, source: "meta_preview" });
          } finally {
            await page.close();
          }
        }
      } catch (err) {
        console.warn(`[keel] preview ${adId} ${placement}: ${(err as Error).message}`);
      }
    }
    return out;
  }

  async close() {
    const b = await this.browser;
    await b?.close();
    this.browser = undefined;
  }
}

/** Local fixtures: eval/fixtures/<adId>/variant-*.{png,jpg}. Used for the eval set and as the demo fallback. */
export class FixtureVariantSource implements VariantSource {
  readonly name = "fixtures";
  constructor(private root = join(REPO_ROOT, "eval/fixtures")) {}
  async listVariants(adId: string): Promise<Variant[]> {
    const dir = join(this.root, adId);
    const files = await readdir(dir).catch(() => [] as string[]);
    return files
      .filter((f) => /^variant-.*\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => ({ id: `${adId}:${f}`, adId, placement: "fixture", imageRef: `file://${join(dir, f)}`, source: "fixture" as const }));
  }
}

/** Several sources at once (e.g. live previews plus hand-made fixtures). */
export class CompositeVariantSource implements VariantSource {
  readonly name: string;
  constructor(private sources: VariantSource[]) { this.name = sources.map((s) => s.name).join("+"); }
  async listVariants(adId: string) {
    return (await Promise.all(this.sources.map((s) => s.listVariants(adId)))).flat();
  }
  async close() { await Promise.all(this.sources.map((s) => s.close?.())); }
}
