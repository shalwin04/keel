import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_SEVERITY, DefectCodeSchema, ScreenResultSchema, type AdSnapshot, type Finding, type Rulebook, type ScreenResult, type Variant } from "@keel/core";
import { callJson, config, metaClient, openWeightClient, type ImageInput, type Segmenter } from "@keel/meta";
import { INSPECT_SYSTEM, SCREEN_SYSTEM, SEGMENT_CONCEPTS, rulebookBlock } from "./prompts.ts";

export type LoadImage = (ref: string) => Promise<ImageInput>;

/** Tier 1: open-weight screen on every variant (Muse Spark Open / Glimmer). */
export function makeScreen(load: LoadImage) {
  return async (snap: AdSnapshot, v: Variant, rulebook?: Rulebook): Promise<ScreenResult> => {
    const images = [await load(snap.originalImageRef ?? ""), await load(v.imageRef)];
    return callJson({
      client: openWeightClient(),
      model: config.openWeight.model,
      system: SCREEN_SYSTEM,
      text: `variantId: ${v.id}\nPlacement: ${v.placement}\nAd copy: ${snap.primaryText ?? "(none)"}\n${rulebookBlock(rulebook)}\nImage 1 = APPROVED ORIGINAL, Image 2 = VARIANT.`,
      images,
      schema: ScreenResultSchema,
    });
  };
}

const InspectOut = z.object({
  findings: z.array(z.object({
    code: DefectCodeSchema,
    summary: z.string(),
    evidence: z.array(z.string()),
    regionLabels: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
  })),
});

/** Tier 2: SAM 3.1 isolates regions, Muse Spark compares them against the original and the rulebook. */
export function makeInspect(load: LoadImage, segmenter: Segmenter) {
  return async (snap: AdSnapshot, v: Variant, screen: ScreenResult, rulebook?: Rulebook): Promise<Finding[]> => {
    const original = await load(snap.originalImageRef ?? "");
    const variant = await load(v.imageRef);
    const [origRegions, varRegions] = await Promise.all([
      segmenter.segment(original, SEGMENT_CONCEPTS),
      segmenter.segment(variant, SEGMENT_CONCEPTS),
    ]);
    const out = await callJson({
      client: metaClient(),
      model: config.models.spark,
      system: INSPECT_SYSTEM,
      text: [
        `Screen note: ${screen.note} (suspected: ${screen.suspected.join(", ") || "none"})`,
        `Original regions: ${JSON.stringify(origRegions)}`,
        `Variant regions: ${JSON.stringify(varRegions)}`,
        rulebookBlock(rulebook),
        "Image 1 = APPROVED ORIGINAL, Image 2 = VARIANT.",
      ].join("\n"),
      images: [original, variant],
      schema: InspectOut,
      reasoningEffort: "medium",
    });
    return out.findings.map((f) => ({
      id: randomUUID(),
      adId: snap.adId,
      variantId: v.id,
      code: f.code,
      severity: DEFAULT_SEVERITY[f.code],
      confidence: f.confidence,
      summary: f.summary,
      evidence: f.evidence,
      regions: varRegions.filter((r) => f.regionLabels.includes(r.label)),
      detectedBy: "inspect" as const,
    }));
  };
}
