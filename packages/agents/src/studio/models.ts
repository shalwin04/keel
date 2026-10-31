import { z } from "zod";
import { DirectionSchema, type Brief, type Direction, type Rulebook } from "@keel/core";
import { callJson, config, editImage, generateImage, metaClient, renderSvgToPng, type ImageInput, type ModelCallInfo } from "@keel/meta";
import { rulebookBlock } from "../prompts.ts";

export type StudioCall = (info: ModelCallInfo & { step: string }) => void;

export interface StudioModels {
  planDirections(brief: Brief, brand: string, product: ImageInput[], rulebook?: Rulebook): Promise<Direction[]>;
  /** A scene for the direction. With a product photo, Muse Image places the real product in it (productInScene). */
  generateScene(direction: Direction, brief: Brief, product: ImageInput[]): Promise<{ bytes: Buffer; productInScene: boolean }>;
  critique(design: ImageInput, product: ImageInput, direction: Direction, rulebook?: Rulebook): Promise<{ pass: boolean; score: number; issues: string[] }>;
}

const PLAN_SYSTEM = `You are Keel Studio's creative director for Meta ads (Facebook and Instagram feed, Stories, Reels).
From a product brief, product photos and the brand rulebook, propose THREE clearly different creative directions.
Each direction: a short title, the angle (why this audience cares), a hook, a scene prompt for an image model,
a headline (max 6 words), a subline (max 12 words), primary text for the ad (max 2 short sentences),
a call to action, and a palette (base background colour, accent, ink = readable text colour on base) taken from the product and brand.
Scene prompts describe ONLY the environment: lighting, place, mood, materials, camera. They must leave clear empty space
for a product to be placed in front, and contain NO product, NO people unless the rulebook allows casting, NO text, NO logos.
Never invent claims, discounts or prices the brief doesn't state. Respect the rulebook's banned content and claim limits.
JSON: {"directions": [{"title","angle","hook","scenePrompt","headline","subline","primaryText","cta","palette":{"base","accent","ink"}}]}`;

const CRITIQUE_SYSTEM = `You are Keel's pre-launch check for a finished ad design.
Image 1 is the REAL product photo. Image 2 is the finished ad.
Check: the product in the ad is the same product (shape, colour, logo) and is not distorted or cropped badly; all text is legible
and correctly spelled; nothing breaks the brand rulebook; the background contains no stray text, logos or people that weren't asked for.
JSON: {"pass": boolean, "score": number 0-1 (1 = ready to launch), "issues": [short plain-English strings]}`;

const Plan = z.object({ directions: z.array(DirectionSchema).min(1).max(3) });
const Critique = z.object({ pass: z.boolean(), score: z.number().min(0).max(1), issues: z.array(z.string()).default([]) });

export function metaStudioModels(onCall?: StudioCall): StudioModels {
  return {
    async planDirections(brief, brand, product, rulebook) {
      const out = await callJson({
        client: metaClient(), model: config.models.wonder, system: PLAN_SYSTEM, schema: Plan, reasoningEffort: "high",
        text: [
          `Brand: ${brand}`, `Product: ${brief.productName} (${brief.productUrl})`,
          brief.price && `Price: ${brief.price}`, brief.offer && `Offer: ${brief.offer}`,
          `Audience: ${brief.audience || "not specified"} · ages ${brief.ageMin}-${brief.ageMax} · ${brief.countries.join(", ")}`,
          brief.notes && `Notes: ${brief.notes}`, rulebookBlock(rulebook),
        ].filter(Boolean).join("\n"),
        images: product.slice(0, 4),
        onCall: (i) => onCall?.({ ...i, step: "plan" }),
      });
      return out.directions;
    },
    async generateScene(direction, brief, product) {
      const t0 = Date.now();
      const look = `Photographic, high detail, natural light. Colour palette: ${direction.palette.base}, ${direction.palette.accent}. No added text, no new logos, no watermarks.`;
      if (product[0]) {
        try {
          // Image-to-image: the real product stays exactly as photographed; only its surroundings change.
          const bytes = await editImage({
            image: product[0],
            prompt: `Keep the ${brief.productName} exactly as it is in this photo: same shape, colours, materials, stitching, logo and proportions. Do not redraw or restyle it. Remove its current background and place it naturally in this scene: ${direction.scenePrompt}. Match lighting and shadows to the scene. Keep the product in the upper two-thirds, centred, filling about half the frame, with calm empty space in the bottom third for headline text. ${look}`,
          });
          onCall?.({ model: config.models.image, ms: Date.now() - t0, step: "scene" });
          return { bytes, productInScene: true };
        } catch (err) {
          console.warn(`[keel] studio: product-in-scene edit failed, generating an empty scene instead: ${(err as Error).message}`);
        }
      }
      const bytes = await generateImage({ prompt: `${direction.scenePrompt}. Empty space in the centre for a product. ${look}`, size: "1024x1024" });
      onCall?.({ model: config.models.image, ms: Date.now() - t0, step: "scene" });
      return { bytes, productInScene: false };
    },
    async critique(design, product, direction, rulebook) {
      return callJson({
        client: metaClient(), model: config.models.spark, system: CRITIQUE_SYSTEM, schema: Critique, reasoningEffort: "medium",
        text: `Direction: ${direction.title}. Headline: "${direction.headline}".\n${rulebookBlock(rulebook)}\nImage 1 = REAL PRODUCT, Image 2 = FINISHED AD.`,
        images: [product, design],
        onCall: (i) => onCall?.({ ...i, step: "check" }),
      });
    },
  };
}

/**
 * Offline stand-ins (STUDIO_FAKE_MODELS=1): deterministic directions and rendered gradient scenes,
 * so Studio can be developed and demoed without model access.
 */
export function fakeStudioModels(): StudioModels {
  const presets: Direction[] = [
    { title: "Monsoon commute", angle: "Stay dry on the way to work without looking like you're in rain gear.", hook: "Rain-ready, office-ready.", scenePrompt: "Rainy city street at dusk, bokeh lights, wet pavement", headline: "Built for the downpour", subline: "Light, warm and properly waterproof.", primaryText: "Your commute doesn't stop for the monsoon. Neither does this jacket.", cta: "SHOP_NOW", palette: { base: "#0f2a3d", accent: "#e0a23b", ink: "#f4efe6" } },
    { title: "Weekend escape", angle: "Hill-station weekends where the weather changes every hour.", hook: "One layer for every forecast.", scenePrompt: "Misty green hills, soft morning light, wooden railing", headline: "One layer, every forecast", subline: "Packs small. Keeps you dry.", primaryText: "Mist at 7, sun at noon, rain by 4. Pack one jacket.", cta: "LEARN_MORE", palette: { base: "#eef1ea", accent: "#2f6b4f", ink: "#1b2a22" } },
    { title: "Minimal studio", angle: "Clean product focus for people who know what they want.", hook: "Nothing extra.", scenePrompt: "Seamless warm grey studio backdrop, soft shadow", headline: "Nothing extra", subline: "A monsoon jacket, done right.", primaryText: "Seam-sealed, breathable, 380 g. That's it.", cta: "SHOP_NOW", palette: { base: "#f4f1ec", accent: "#14324a", ink: "#14324a" } },
  ];
  const sceneSvg = (d: Direction) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.palette.base}"/><stop offset="1" stop-color="${d.palette.accent}"/></linearGradient><radialGradient id="b" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#a)"/><rect width="1024" height="1024" fill="url(#b)"/>${Array.from({ length: 28 }, (_, i) => `<line x1="${(i * 97) % 1024}" y1="${(i * 53) % 900}" x2="${((i * 97) % 1024) - 14}" y2="${((i * 53) % 900) + 60}" stroke="#fff" stroke-opacity=".18" stroke-width="3"/>`).join("")}</svg>`;
  return {
    async planDirections(brief) {
      return presets.map((d) => ({ ...d, primaryText: d.primaryText.replace("this jacket", brief.productName) }));
    },
    async generateScene(direction) {
      return { bytes: await renderSvgToPng(sceneSvg(direction), 1024, 1024), productInScene: false };
    },
    async critique() {
      return { pass: true, score: 0.92, issues: [] };
    },
  };
}
