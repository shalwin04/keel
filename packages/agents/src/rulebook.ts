import { RulebookSchema, type Rulebook } from "@keel/core";
import { callJson, config, metaClient, type ImageInput } from "@keel/meta";
import { RULEBOOK_SYSTEM } from "./prompts.ts";
import type { OnModelCall } from "./judges.ts";

/** Muse Wonder drafts a brand rulebook from the brand's best past ads (onboarding). */
export async function draftRulebook(
  brand: string,
  ads: { image: ImageInput; copy?: string }[],
  guidelines = "",
  onCall?: OnModelCall,
): Promise<Rulebook> {
  const draft = await callJson({
    client: metaClient(),
    model: config.models.wonder,
    system: RULEBOOK_SYSTEM,
    text: [
      `Brand: ${brand}`,
      `There are ${ads.length} approved ads, in order. Their copy:`,
      ...ads.map((a, i) => `${i + 1}. ${a.copy ?? "(no copy)"}`),
      guidelines ? `Brand guidelines:\n${guidelines}` : "No written guidelines.",
      `Return JSON with: brand, version (1), audience {description, casting[]}, palette[], tone, banned[], claimLimits[], productTruths[{product, facts[]}], lockedEnhancements[], severityOverrides {}.`,
    ].join("\n"),
    images: ads.map((a) => a.image),
    schema: RulebookSchema,
    reasoningEffort: "high",
    onCall: (i) => onCall?.({ ...i, tier: "inspect" }),
  });
  return { ...draft, brand, version: 1 };
}
