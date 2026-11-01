import { z } from "zod";
import {
  AdAnalysisSchema, DirectionSchema, InsightsSchema,
  type AdAnalysis, type Brief, type CompetitorAd, type Direction, type Insights, type ReelShot, type Rulebook,
} from "@keel/core";
import { callJson, config, editImage, generateImage, metaClient, renderSvgToPng, type ImageInput, type ModelCallInfo } from "@keel/meta";
import { rulebookBlock } from "../prompts.ts";

export type StudioCall = (info: ModelCallInfo & { step: string }) => void;

export interface SceneScore { index: number; score: number; product: number; aesthetics: number; layoutFit: number; notes: string }
export interface SceneRanking { scores: SceneScore[]; best: number; fix: string; space: "bottom" | "top" | "left" | "right" | "none" }

/** Everything Studio asks of a model. Real (Meta) and offline (fake) implementations share it. */
export interface StudioModels {
  researchPlan(brief: Brief, brand: string): Promise<{ searchTerms: string[]; competitors: string[] }>;
  analyzeAd(ad: { image?: ImageInput; body?: string; title?: string; pageName: string }): Promise<AdAnalysis>;
  synthesize(brief: Brief, brand: string, ads: CompetitorAd[]): Promise<Insights>;
  planDirections(brief: Brief, brand: string, product: ImageInput[], rulebook: Rulebook | undefined, insights: Insights | undefined): Promise<Direction[]>;
  /** One scene candidate. With a product photo, Muse Image places the real product in it (productInScene). */
  generateScene(direction: Direction, brief: Brief, product: ImageInput[], variant: number): Promise<{ bytes: Buffer; productInScene: boolean }>;
  rankScenes(candidates: ImageInput[], product: ImageInput, direction: Direction): Promise<SceneRanking>;
  refineScene(image: ImageInput, fix: string, brief: Brief): Promise<Buffer>;
  storyboardFrame(shot: ReelShot, direction: Direction, brief: Brief, product: ImageInput[]): Promise<Buffer>;
  critique(design: ImageInput, product: ImageInput, direction: Direction, rulebook?: Rulebook): Promise<{ pass: boolean; score: number; issues: string[] }>;
}

// ── prompts ──────────────────────────────────────────────────────────────────

const RESEARCH_PLAN = `You plan competitor research for a Meta ad campaign.
From the brief, list who the product competes with on Facebook and Instagram: well-known brands in that category and market
(include any the brief names), and 3-5 short search terms people in the Ad Library would use to find ads in this category.
JSON: {"competitors": [string], "searchTerms": [string]}`;

const ANALYZE_AD = `You are a senior paid-social strategist reviewing ONE competitor ad (screenshot plus its copy, if any).
Describe it precisely and briefly: format (static, carousel, UGC video, studio product shot, lifestyle, meme…), the hook (what grabs attention
in the first second), the visual style (lighting, setting, casting, composition), up to 4 dominant colours as hex, the offer, the CTA,
the emotion it plays on, and strength 0-1 (how well-made and on-message it is for its audience).
JSON: {"format","hook","visual","palette":[hex],"offer","cta","emotion","strength"}`;

const SYNTHESIZE = `You are a creative strategist. Below are competitor ads in our category with an analysis of each, and how long each has run
(long-running ads are usually the ones that work). Find the patterns: what most of them do (with counts and example ad ids), what is saturated
and easy to blend into, and the white space our brand could own. Finish with concrete recommendations for our campaign.
Be specific and evidence-based; never invent ads that aren't listed.
JSON: {"summary","patterns":[{"label","detail","count","examples":[adId]}],"saturated":[string],"whiteSpace":[string],"recommendations":[string]}`;

const PLAN_SYSTEM = `You are Keel Studio's creative director for Meta ads (Facebook and Instagram feed, Stories, Reels).
Using the competitor insights, the brief, the product photos and the brand rulebook, propose THREE clearly different creative directions that
stand out from what competitors do. For each direction give:
- title, angle (why this audience cares), hook, rationale (which insight it answers, in one sentence)
- scenePrompt: the hero image's environment only (place, light, mood, materials). Never describe the product itself; it is placed from the real photo.
- art: an art director's brief that makes it look professionally shot: camera (body, lens, angle, distance), lighting (key/fill/rim, time of day),
  grade (colour grading, film look), composition (where the product sits; leave clean negative space in the bottom third for the headline),
  props (2-3 tasteful supporting objects), avoid (what would cheapen it)
- headline (max 6 words), subline (max 12 words), primaryText (max 2 short sentences), cta
- palette: base (background), accent, ink (text readable on base), taken from the product and brand
- storyboard: beats = 3-4 campaign beats over the flight (name, when, goal, message, visual), and reel = 4-5 shots for a 15-second Reel
  (seconds, visual, onScreenText (max 5 words), motion: push-in | pull-out | pan-left | pan-right | static, showsProduct)
Never invent claims, discounts or prices the brief doesn't state. Respect the rulebook's banned content and claim limits.
No people unless the rulebook's casting allows them.
JSON: {"directions": [ ... ]}`;

const RANK_SCENES = `You are the art director choosing the best hero image for a Meta ad. Image 1 is the REAL product photo; the rest are candidates (numbered from 0).
Score each candidate 0-1 on: product (is it exactly the real product, undistorted, not redrawn), aesthetics (would a top agency ship it: light, depth,
colour, realism, no AI artefacts), layoutFit (clean negative space where the direction asks for the headline). Pick the best.
If the best still has a fixable problem, write ONE precise edit instruction for an image editor ("darken the top-left corner", "remove the
stray reflection on the left sleeve"); otherwise an empty string. Say where the largest clean empty area is: bottom, top, left, right, or none.
JSON: {"scores":[{"index","score","product","aesthetics","layoutFit","notes"}],"best": number,"fix": string,"space": "bottom"|"top"|"left"|"right"|"none"}`;

const CRITIQUE_SYSTEM = `You are Keel's pre-launch check for a finished ad design.
Image 1 is the REAL product photo. Image 2 is the finished ad.
Check: the product in the ad is the same product (shape, colour, logo) and is not distorted or cropped badly; all text is legible
and correctly spelled; nothing breaks the brand rulebook; the background contains no stray text, logos or people that weren't asked for.
JSON: {"pass": boolean, "score": number 0-1 (1 = ready to launch), "issues": [short plain-English strings]}`;

const shotPrompt = (d: Direction, extra = "") => [
  d.scenePrompt,
  d.art.camera && `Camera: ${d.art.camera}.`, d.art.lighting && `Lighting: ${d.art.lighting}.`, d.art.grade && `Grade: ${d.art.grade}.`,
  d.art.composition && `Composition: ${d.art.composition}.`, d.art.props && `Props: ${d.art.props}.`,
  `Palette: ${d.palette.base}, ${d.palette.accent}.`, extra,
  `Photorealistic commercial photography, crisp detail, natural depth of field. No added text, no new logos, no watermarks.${d.art.avoid ? ` Avoid: ${d.art.avoid}.` : ""}`,
].filter(Boolean).join(" ");

const keepProduct = (name: string) => `Keep the ${name} exactly as it is in this photo: same shape, colours, materials, stitching, logo and proportions. Do not redraw, restyle, recolour or resize it unnaturally. Remove its current background and place it naturally in this scene, with lighting and contact shadows matched to the scene:`;

// The art director gets a couple of different takes per scene to choose from.
const VARIANTS = ["", "Alternative take: a slightly wider framing with more of the environment.", "Alternative take: closer, more dramatic framing with shallower depth of field."];

export function metaStudioModels(onCall?: StudioCall): StudioModels {
  const call = <T,>(step: string, model: string, system: string, schema: z.ZodType<T>, text: string, images: ImageInput[] = [], effort: "low" | "medium" | "high" = "medium") =>
    callJson({ client: metaClient(), model, system, schema, text, images, reasoningEffort: effort, onCall: (i) => onCall?.({ ...i, step }) });
  const timed = async <T,>(step: string, fn: () => Promise<T>) => {
    const t0 = Date.now();
    const v = await fn();
    onCall?.({ model: config.models.image, ms: Date.now() - t0, step });
    return v;
  };

  return {
    researchPlan: (brief, brand) => call("research", config.models.wonder, RESEARCH_PLAN,
      z.object({ competitors: z.array(z.string()).max(8).catch([]), searchTerms: z.array(z.string()).max(6).catch([]) }),
      [`Brand: ${brand}`, `Product: ${brief.productName} (${brief.productUrl})`, `Market: ${brief.countries.join(", ")}`, brief.audience && `Audience: ${brief.audience}`,
        brief.competitors.length ? `Competitors named by the brand: ${brief.competitors.join(", ")}` : ""].filter(Boolean).join("\n"), [], "low"),

    analyzeAd: (ad) => call("analyze", config.models.spark, ANALYZE_AD, AdAnalysisSchema,
      [`Advertiser: ${ad.pageName}`, ad.title && `Headline: ${ad.title}`, ad.body && `Copy: ${ad.body.slice(0, 600)}`].filter(Boolean).join("\n"), ad.image ? [ad.image] : [], "low"),

    synthesize: (brief, brand, ads) => call("insights", config.models.wonder, SYNTHESIZE, InsightsSchema,
      [`Our brand: ${brand}. Product: ${brief.productName}. Audience: ${brief.audience || "not stated"}. Market: ${brief.countries.join(", ")}.`,
        "Competitor ads:", ...ads.map((a) => JSON.stringify({ id: a.id, advertiser: a.pageName, daysRunning: a.daysRunning, copy: a.body?.slice(0, 300), headline: a.title, analysis: a.analysis }))].join("\n"), [], "high"),

    async planDirections(brief, brand, product, rulebook, insights) {
      const out = await call("strategy", config.models.wonder, PLAN_SYSTEM, z.object({ directions: z.array(DirectionSchema).min(1).max(3) }),
        [`Brand: ${brand}`, `Product: ${brief.productName} (${brief.productUrl})`, brief.price && `Price: ${brief.price}`, brief.offer && `Offer: ${brief.offer}`,
          `Audience: ${brief.audience || "not specified"} · ages ${brief.ageMin}-${brief.ageMax} · ${brief.countries.join(", ")}`,
          `Flight: ${brief.startDate} to ${brief.endDate}`, brief.notes && `Notes: ${brief.notes}`,
          insights ? `COMPETITOR INSIGHTS:\n${JSON.stringify(insights)}` : "No competitor research available.", rulebookBlock(rulebook)].filter(Boolean).join("\n"),
        product.slice(0, 4), "high");
      return out.directions;
    },

    generateScene: (direction, brief, product, variant) => timed("scene", async () => {
      const extra = VARIANTS[variant % VARIANTS.length]!;
      if (product[0]) {
        try {
          return { bytes: await editImage({ image: product[0], prompt: `${keepProduct(brief.productName)} ${shotPrompt(direction, extra)}` }), productInScene: true };
        } catch (err) {
          console.warn(`[keel] studio: product-in-scene edit failed, generating an empty scene: ${(err as Error).message}`);
        }
      }
      return { bytes: await generateImage({ prompt: shotPrompt(direction, `${extra} Leave clear space in the centre for a product.`), size: "1024x1024" }), productInScene: false };
    }),

    rankScenes: (candidates, product, direction) => call("art-direct", config.models.spark, RANK_SCENES,
      z.object({
        scores: z.array(z.object({ index: z.number().int(), score: z.number(), product: z.number().catch(0.5), aesthetics: z.number().catch(0.5), layoutFit: z.number().catch(0.5), notes: z.string().catch("") })),
        best: z.number().int(), fix: z.string().catch(""), space: z.enum(["bottom", "top", "left", "right", "none"]).catch("bottom"),
      }),
      `Direction: ${direction.title}. Wanted composition: ${direction.art.composition || "product upper-centre, headline space bottom third"}.\nImage 1 = REAL PRODUCT; candidates follow, numbered from 0.`,
      [product, ...candidates], "medium"),

    refineScene: (image, fix, brief) => timed("refine", () => editImage({ image, prompt: `${fix}. Change nothing else. Keep the ${brief.productName} exactly as it is.` })),

    storyboardFrame: (shot, direction, brief, product) => timed("storyboard", async () => {
      const prompt = shotPrompt(direction, `Storyboard frame: ${shot.visual}.`);
      if (shot.showsProduct && product[0]) {
        try { return await editImage({ image: product[0], prompt: `${keepProduct(brief.productName)} ${prompt}` }); } catch { /* fall through */ }
      }
      return generateImage({ prompt, size: "1024x1024" });
    }),

    critique: (design, product, direction, rulebook) => call("check", config.models.spark, CRITIQUE_SYSTEM,
      z.object({ pass: z.boolean(), score: z.number().min(0).max(1), issues: z.array(z.string()).default([]) }),
      `Direction: ${direction.title}. Headline: "${direction.headline}".\n${rulebookBlock(rulebook)}\nImage 1 = REAL PRODUCT, Image 2 = FINISHED AD.`, [product, design]),
  };
}

// ── offline stand-ins (STUDIO_FAKE_MODELS=1) ─────────────────────────────────

const art = { camera: "", lighting: "", grade: "", composition: "", props: "", avoid: "" };
const reel = (t: string[]): ReelShot[] => t.map((visual, i) => ({ seconds: [2.5, 3, 3.5, 3, 3][i] ?? 3, visual, onScreenText: ["Rain again?", "Still dry.", "Light. Warm.", "Built for it.", "Shop now"][i] ?? "", motion: (["push-in", "pan-left", "pull-out", "pan-right", "static"] as const)[i % 5]!, showsProduct: i !== 0 }));

/** Deterministic directions, research and gradient scenes so Studio can be developed and demoed without model access. */
export function fakeStudioModels(): StudioModels {
  const presets: Direction[] = [
    { title: "Monsoon commute", angle: "Stay dry on the way to work without looking like you're in rain gear.", hook: "Rain-ready, office-ready.", rationale: "Competitors show hikers and mountains; nobody speaks to the daily commute.", scenePrompt: "Rainy city street at dusk, bokeh lights, wet pavement", headline: "Built for the downpour", subline: "Light, warm and properly waterproof.", primaryText: "Your commute doesn't stop for the monsoon. Neither does this jacket.", cta: "SHOP_NOW", palette: { base: "#0f2a3d", accent: "#e0a23b", ink: "#f4efe6" }, art,
      storyboard: { beats: [{ name: "Hook", when: "Week 1", goal: "Stop the scroll", message: "Rain again?", visual: "Drenched commuter, then a dry one" }, { name: "Proof", when: "Week 2", goal: "Show it works", message: "Seam-sealed, 380 g", visual: "Water beading on the sleeve" }, { name: "Offer", when: "Week 3", goal: "Convert", message: "Before the next downpour", visual: "Product on a rack, CTA" }], reel: reel(["Rain hitting a bus-stop window", "Jacket on a hook, droplets beading", "Close-up of sealed seams", "Jacket in neon street light", "Logo and CTA end card"]) } },
    { title: "Weekend escape", angle: "Hill-station weekends where the weather changes every hour.", hook: "One layer for every forecast.", rationale: "Outdoor brands overuse summit shots; weekend trips are under-served.", scenePrompt: "Misty green hills, soft morning light, wooden railing", headline: "One layer, every forecast", subline: "Packs small. Keeps you dry.", primaryText: "Mist at 7, sun at noon, rain by 4. Pack one jacket.", cta: "LEARN_MORE", palette: { base: "#eef1ea", accent: "#2f6b4f", ink: "#1b2a22" }, art, storyboard: { beats: [], reel: [] } },
    { title: "Minimal studio", angle: "Clean product focus for people who know what they want.", hook: "Nothing extra.", rationale: "Every competitor is busy; a calm studio shot stands out in feed.", scenePrompt: "Seamless warm grey studio backdrop, soft shadow", headline: "Nothing extra", subline: "A monsoon jacket, done right.", primaryText: "Seam-sealed, breathable, 380 g. That's it.", cta: "SHOP_NOW", palette: { base: "#f4f1ec", accent: "#14324a", ink: "#14324a" }, art, storyboard: { beats: [], reel: [] } },
  ];
  const sceneSvg = (a: string, b: string, seed: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><radialGradient id="b" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#a)"/><rect width="1024" height="1024" fill="url(#b)"/>${Array.from({ length: 28 }, (_, i) => `<line x1="${(i * 97 + seed * 41) % 1024}" y1="${(i * 53) % 900}" x2="${((i * 97 + seed * 41) % 1024) - 14}" y2="${((i * 53) % 900) + 60}" stroke="#fff" stroke-opacity=".18" stroke-width="3"/>`).join("")}</svg>`;
  return {
    async researchPlan(brief) {
      return { competitors: brief.competitors.length ? brief.competitors : ["Decathlon", "Wildcraft", "The North Face"], searchTerms: ["rain jacket", "monsoon jacket", "waterproof jacket"] };
    },
    async analyzeAd(ad) {
      const n = ad.pageName.length;
      return { format: ["Lifestyle photo", "Studio product shot", "UGC video"][n % 3]!, hook: ["Mountain summit at sunrise", "Big discount badge", "Person shaking off rain"][n % 3]!, visual: "Bright, saturated outdoor scene", palette: ["#1f4e79", "#f2a900"], offer: n % 2 ? "Up to 40% off" : "", cta: "Shop now", emotion: ["Adventure", "Value", "Relief"][n % 3]!, strength: 0.5 + (n % 5) / 10 };
    },
    async synthesize(_b, _brand, ads) {
      return {
        summary: `${ads.length} competitor ads reviewed. Most lean on mountain adventure and discount badges; almost none show everyday city use in the rain.`,
        patterns: [{ label: "Summit and trail imagery", detail: "Hero shots on peaks and trails", count: Math.ceil(ads.length / 2), examples: ads.slice(0, 2).map((a) => a.id) }, { label: "Discount-led copy", detail: "Price cuts in the first line", count: Math.ceil(ads.length / 3), examples: ads.slice(2, 3).map((a) => a.id) }],
        saturated: ["Mountain-top hero shots", "\"Up to X% off\" headlines"],
        whiteSpace: ["Daily monsoon commute", "Calm, premium studio product focus"],
        recommendations: ["Lead with the commute, not the summit", "Show the product dry in visibly wet conditions", "Keep price visible but not the hook"],
      };
    },
    async planDirections(brief) {
      return presets.map((d) => ({ ...d, primaryText: d.primaryText.replace("this jacket", brief.productName) }));
    },
    async generateScene(direction, _brief, _product, variant) {
      return { bytes: await renderSvgToPng(sceneSvg(direction.palette.base, direction.palette.accent, variant), 1024, 1024), productInScene: false };
    },
    async rankScenes(candidates) {
      return { scores: candidates.map((_, index) => ({ index, score: 0.7 + index * 0.05, product: 0.9, aesthetics: 0.7 + index * 0.05, layoutFit: 0.8, notes: index ? "Better depth" : "Flat light" })), best: candidates.length - 1, fix: "", space: "bottom" };
    },
    async refineScene(image) {
      return Buffer.from(("dataUrl" in image ? image.dataUrl : "").split(",")[1] ?? "", "base64");
    },
    async storyboardFrame(_shot, direction) {
      return renderSvgToPng(sceneSvg(direction.palette.accent, direction.palette.base, 7), 1024, 1024);
    },
    async critique() {
      return { pass: true, score: 0.92, issues: [] };
    },
  };
}
