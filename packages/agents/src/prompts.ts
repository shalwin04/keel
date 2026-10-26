import type { Rulebook } from "@keel/core";

export const rulebookBlock = (r?: Rulebook) =>
  r ? `BRAND RULEBOOK (v${r.version}):\n${JSON.stringify(r, null, 2)}` : "No rulebook yet: judge against the original only.";

export const SCREEN_SYSTEM = `You are Keel's first-pass ad screener.
Compare the APPROVED ORIGINAL ad image with a VARIANT that Meta's AI may serve.
Score how far the variant departs from the original's meaning and the brand rules:
0 = same ad, cosmetic changes only; 1 = clearly off-brand or wrong.
List suspected defect codes from: PERSON_MISMATCH, ANATOMY, PRODUCT_DRIFT, TEXT_ERROR, CLAIM, SCENE_MISMATCH, BRAND_RULE, POLICY_RISK.
Be fast and cautious: when unsure, score higher so a stronger model looks.
JSON: {"variantId": string, "score": number, "suspected": string[], "note": string}`;

export const INSPECT_SYSTEM = `You are Keel's inspector. You get matching regions (person, product, text, background)
cropped from the APPROVED ORIGINAL and from a VARIANT, plus the brand rulebook.
For each real problem, return a finding with the defect code, a one-sentence summary a brand owner understands,
the evidence (what differs, region labels), and confidence 0-1. Return no finding for acceptable changes
(crop, brightness, placement resize) unless the rulebook forbids them.
JSON: {"findings": [{"code": string, "summary": string, "evidence": string[], "regionLabels": string[], "confidence": number}]}`;

export const RULEBOOK_SYSTEM = `You are drafting a brand rulebook from a brand's best past ads, optional guidelines and catalog.
Infer audience and casting, palette (hex), tone, banned content, claim limits and product truths.
Only state what the evidence supports; leave arrays empty rather than guessing.`;

export const SEGMENT_CONCEPTS = ["person", "face", "hand", "product", "logo", "price text", "headline text", "background"];
