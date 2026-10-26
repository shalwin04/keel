import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Variant } from "@keel/core";
import type { AdsGraphClient } from "./ads.ts";

/** Where rendered variants come from. Pluggable so the demo never depends on one API surface. */
export interface VariantSource {
  listVariants(adId: string): Promise<Variant[]>;
}

/** Marketing API ad previews. TODO(day 1): render iframe HTML to PNG (Playwright) and store it. */
export class MetaPreviewSource implements VariantSource {
  constructor(private ads: AdsGraphClient, private formats = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_REELS"]) {}
  async listVariants(adId: string): Promise<Variant[]> {
    const out: Variant[] = [];
    for (const placement of this.formats) {
      const { data } = await this.ads.getPreviews(adId, placement);
      data.forEach((_d, i) => out.push({ id: `${adId}:${placement}:${i}`, adId, placement, imageRef: `preview://${adId}/${placement}/${i}`, source: "meta_preview" }));
    }
    return out;
  }
}

/** Local fixtures: eval/fixtures/<adId>/variant-*.{png,jpg}. Used for the eval set and as the demo fallback. */
export class FixtureVariantSource implements VariantSource {
  constructor(private root = "eval/fixtures") {}
  async listVariants(adId: string): Promise<Variant[]> {
    const dir = join(this.root, adId);
    const files = await readdir(dir).catch(() => [] as string[]);
    return files
      .filter((f) => /^variant-.*\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => ({ id: `${adId}:${f}`, adId, placement: "fixture", imageRef: `file://${join(dir, f)}`, source: "fixture" as const }));
  }
}
