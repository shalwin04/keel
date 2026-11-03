/**
 * Keel Studio: campaigns as layered designs.
 *
 * AI makes the parts (scenes, copy); this file lays them out exactly (product photo untouched, text as real
 * type, price from the brief). Pure functions with no Node or DOM imports, so the server renderer and the
 * browser editor produce the same picture from the same document.
 */
import { z } from "zod";

// ── Brief and creative directions ────────────────────────────────────────────

export const BriefSchema = z.object({
  productName: z.string().min(1).max(120),
  productUrl: z.string().url(),
  productPhotos: z.array(z.string()).min(1).max(6),
  referenceImages: z.array(z.string()).max(6).default([]),
  price: z.string().max(40).default(""),
  offer: z.string().max(80).default(""),
  audience: z.string().max(400).default(""),
  countries: z.array(z.string().length(2)).min(1).default(["IN"]),
  ageMin: z.number().int().min(18).max(65).default(18),
  ageMax: z.number().int().min(18).max(65).default(65),
  dailyBudget: z.number().positive().max(1_000_000),
  startDate: z.string(),
  endDate: z.string(),
  notes: z.string().max(2000).default(""),
  /** Competitor brands, Facebook Page names or URLs, or keywords the agent should research. */
  competitors: z.array(z.string().max(120)).max(8).default([]),
  /** Screenshots of competitor ads the person already has (used alongside, or instead of, the Ad Library). */
  competitorShots: z.array(z.string()).max(12).default([]),
  /** The brand name to show (Autopilot reads it from the website); defaults to the workspace's brand. */
  brand: z.string().max(80).optional(),
  /** The brand's logo (saved image ref); used on designs instead of the brand name. */
  logoRef: z.string().optional(),
  /** traffic = website visits (link clicks); sales = purchases through the Meta Pixel. */
  objective: z.enum(["traffic", "sales"]).default("traffic"),
});
export type Brief = z.infer<typeof BriefSchema>;

// ── Research ─────────────────────────────────────────────────────────────────

export const AdAnalysisSchema = z.object({
  format: z.string().max(80).catch(""),
  hook: z.string().max(200).catch(""),
  visual: z.string().max(300).catch(""),
  palette: z.array(z.string()).max(6).catch([]),
  offer: z.string().max(120).catch(""),
  cta: z.string().max(60).catch(""),
  emotion: z.string().max(80).catch(""),
  strength: z.number().min(0).max(1).catch(0.5),
});
export type AdAnalysis = z.infer<typeof AdAnalysisSchema>;

export interface CompetitorAd {
  id: string;
  source: "ad_library" | "upload" | "site";
  pageName: string;
  body?: string;
  title?: string;
  startedAt?: string;
  stoppedAt?: string;
  daysRunning?: number;
  platforms?: string[];
  snapshotRef?: string;
  libraryUrl?: string;
  /** For source "site": the competitor's website that was read. */
  siteUrl?: string;
  analysis?: AdAnalysis;
}

export const InsightsSchema = z.object({
  summary: z.string().max(800),
  patterns: z.array(z.object({ label: z.string().max(120), detail: z.string().max(300).catch(""), count: z.number().int().min(0).catch(0), examples: z.array(z.string()).max(6).catch([]) })).max(8).catch([]),
  saturated: z.array(z.string().max(200)).max(6).catch([]),
  whiteSpace: z.array(z.string().max(200)).max(6).catch([]),
  recommendations: z.array(z.string().max(240)).max(6).catch([]),
});
export type Insights = z.infer<typeof InsightsSchema>;

/** What customers actually say (reviews, Reddit threads, Q&A), turned into personas and their own words. */
export const VoiceSchema = z.object({
  summary: z.string().max(600).catch(""),
  personas: z.array(z.object({
    name: z.string().max(60), who: z.string().max(200).catch(""),
    pains: z.array(z.string().max(160)).max(5).catch([]), desires: z.array(z.string().max(160)).max(5).catch([]), objections: z.array(z.string().max(160)).max(4).catch([]),
    quotes: z.array(z.string().max(240)).max(4).catch([]),
  })).max(4).catch([]),
  phrases: z.array(z.string().max(120)).max(12).catch([]),
});
export type Voice = z.infer<typeof VoiceSchema> & { quotes: { text: string; source: string; url?: string }[] };

export interface Research {
  /** Voice of the customer, when the agent found real reviews or threads. */
  voice?: Voice;
  searchTerms: string[];
  competitors: string[];
  source: "ad_library" | "uploads" | "sites" | "mixed" | "none";
  note?: string;
  ads: CompetitorAd[];
  insights: Insights;
}

export const CTA_TYPES = ["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "GET_OFFER", "ORDER_NOW", "SEE_MORE"] as const;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Static ad formats beyond the classic layouts: each one a proven pattern on Facebook and Instagram. */
export const FORMATS = ["classic", "notes", "tweet", "testimonial", "versus", "beforeafter", "offer", "meme", "ugc"] as const;
export type FormatKey = (typeof FORMATS)[number];
export const FORMAT_LABEL: Record<FormatKey, string> = {
  classic: "Hero", notes: "Notes app", tweet: "Post card", testimonial: "Customer quote", versus: "Us vs them", beforeafter: "Before / after", offer: "Offer", meme: "Meme", ugc: "Creator caption",
};
/** Which formats need generated scenes (0, 1 or 2 images). */
export const FORMAT_SCENES: Record<FormatKey, number> = { classic: 1, notes: 0, tweet: 0, testimonial: 0, versus: 0, beforeafter: 2, offer: 0, meme: 1, ugc: 1 };

/** Visual languages the art director can choose for a concept; each maps to an expert prompt block for Muse Image. */
export const VISUAL_STYLES = ["photoreal", "lifestyle", "cinematic", "render3d", "clay", "isometric", "illustration", "risograph", "papercut", "collage"] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];
export const STYLE_LABEL: Record<VisualStyle, string> = {
  photoreal: "Studio photo", lifestyle: "Lifestyle photo", cinematic: "Cinematic still", render3d: "3D render", clay: "Clay 3D", isometric: "Isometric 3D",
  illustration: "Flat illustration", risograph: "Risograph", papercut: "Paper-cut", collage: "Collage",
};
/** How each style should be rendered: the kind of brief a top photographer, 3D artist or illustrator would write. */
export const STYLE_BLOCK: Record<VisualStyle, string> = {
  photoreal: "Commercial product photograph: full-frame camera, 100mm macro lens at f/5.6, large softbox key light from 45° left with white bounce fill and a thin rim light from behind, true-to-life colour, crisp micro-detail on every material, natural contact shadows, premium set styling with tactile surfaces.",
  lifestyle: "Editorial lifestyle photograph, candid and real: 35mm lens at f/2, natural window or golden-hour light, soft film grain with a Kodak Portra 400 palette, authentic location and props, real skin texture, shallow depth of field, a moment that feels caught, not posed.",
  cinematic: "Cinematic film still: anamorphic 40mm lens, motivated practical lighting, light atmospheric haze, rich contrast with a teal-and-amber grade, an emotional storytelling moment frozen mid-action, the kind of frame from a premium brand film.",
  render3d: "High-end 3D product render (Octane/Redshift look): physically based materials, studio HDRI with softbox reflections, subtle ambient occlusion, a few floating abstract props, smooth gradient backdrop in the brand colours, impeccably clean.",
  clay: "Soft 3D claymation style: smooth matte clay materials, rounded friendly shapes, soft global illumination, a playful miniature set in the brand palette, charming and tactile like a stop-motion frame.",
  isometric: "Isometric 3D diorama: a tiny detailed world on a floating base telling the story, tilt-shift miniature feel, soft shadows, brand colour palette, crisp and delightful.",
  illustration: "Modern editorial flat vector illustration: bold geometric shapes, a limited palette from the brand colours, subtle grain texture, confident linework, magazine-cover quality.",
  risograph: "Risograph-print illustration: two or three spot colours from the brand palette, visible grain and slight misregistration, bold simplified shapes, indie gig-poster energy.",
  papercut: "Layered paper-cut craft art: real cut paper layers with physical depth and soft shadows between them, brand palette, handmade texture, photographed straight on.",
  collage: "Mixed-media collage: cut-out photographic elements, torn paper edges, halftone textures, sticker accents, energetic Gen-Z editorial look.",
};
export const PHOTO_STYLES: VisualStyle[] = ["photoreal", "lifestyle", "cinematic"];

export const FormatCopySchema = z.object({
  lines: z.array(z.string().max(90)).max(6).catch([]),
  quote: z.string().max(220).catch(""),
  author: z.string().max(80).catch(""),
  rows: z.array(z.object({ label: z.string().max(40), us: z.string().max(40), them: z.string().max(40) })).max(5).catch([]),
  them: z.string().max(40).catch("Others"),
  before: z.string().max(60).catch(""),
  after: z.string().max(60).catch(""),
  top: z.string().max(90).catch(""),
  bottom: z.string().max(90).catch(""),
  sticker: z.string().max(90).catch(""),
  /** A second scene prompt (before/after: the "before" state). */
  scene2: z.string().max(600).catch(""),
});
export type FormatCopy = z.infer<typeof FormatCopySchema>;

export const DirectionSchema = z.object({
  title: z.string().max(60),
  angle: z.string().max(240),
  hook: z.string().max(120),
  scenePrompt: z.string().max(800),
  headline: z.string().max(60),
  subline: z.string().max(90),
  primaryText: z.string().max(280),
  cta: z.enum(CTA_TYPES).catch("SHOP_NOW"),
  palette: z.object({ base: hex, accent: hex, ink: hex }),
  /** Which research insight this direction answers (shown so people can see the reasoning). */
  rationale: z.string().max(300).catch(""),
  /** The art director's brief for the hero image: what makes it look professionally shot. */
  art: z.object({
    camera: z.string().max(160).catch(""),
    lighting: z.string().max(160).catch(""),
    grade: z.string().max(160).catch(""),
    composition: z.string().max(200).catch(""),
    props: z.string().max(200).catch(""),
    avoid: z.string().max(200).catch(""),
  }).catch({ camera: "", lighting: "", grade: "", composition: "", props: "", avoid: "" }),
  storyboard: z.object({
    beats: z.array(z.object({ name: z.string().max(40), when: z.string().max(60).catch(""), goal: z.string().max(160).catch(""), message: z.string().max(160).catch(""), visual: z.string().max(240).catch("") })).max(5).catch([]),
    reel: z.array(z.object({
      seconds: z.number().min(0.5).max(8).catch(3),
      visual: z.string().max(300),
      onScreenText: z.string().max(60).catch(""),
      motion: z.enum(["push-in", "pull-out", "pan-left", "pan-right", "static"]).catch("push-in"),
      showsProduct: z.boolean().catch(true),
    })).max(6).catch([]),
  }).catch({ beats: [], reel: [] }),
  /** Concept formats (the concept board). Absent = classic. */
  format: z.enum(FORMATS).optional().catch(undefined),
  copy: FormatCopySchema.optional().catch(undefined),
  /** The customer persona this speaks to (from research into what customers say). */
  persona: z.string().max(80).optional().catch(undefined),
  /** The visual language the art director chose for this idea. */
  style: z.enum(VISUAL_STYLES).optional().catch(undefined),
  /** The story moment the image shows: who, where, what is happening, the emotion. */
  visual: z.string().max(600).optional().catch(undefined),
});
export type Direction = z.infer<typeof DirectionSchema>;
export type ReelShot = Direction["storyboard"]["reel"][number];

// ── Layered design document ─────────────────────────────────────────────────

export const SIZES = { square: { w: 1080, h: 1080, label: "1:1 Feed" }, portrait: { w: 1080, h: 1350, label: "4:5 Feed" }, story: { w: 1080, h: 1920, label: "9:16 Stories & Reels" } } as const;
export type SizeKey = keyof typeof SIZES;
export const TEMPLATES = ["hero", "split", "card"] as const;
export type TemplateKey = (typeof TEMPLATES)[number];

const box = { x: z.number(), y: z.number(), w: z.number(), h: z.number() };
export const LayerSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("image"), role: z.enum(["scene", "product", "logo", "person"]), ref: z.string(), ...box,
    fit: z.enum(["cover", "contain"]).default("cover"), radius: z.number().default(0), shadow: z.boolean().default(false), opacity: z.number().default(1), locked: z.boolean().default(false) }),
  z.object({ id: z.string(), kind: z.literal("rect"), role: z.enum(["panel", "scrim", "card", "chip"]), ...box,
    fill: z.string(), fill2: z.string().optional(), angle: z.number().default(180), radius: z.number().default(0), opacity: z.number().default(1), shadow: z.boolean().default(false), locked: z.boolean().default(false) }),
  z.object({ id: z.string(), kind: z.literal("text"), role: z.enum(["headline", "subline", "price", "cta", "brand", "offer", "body"]), text: z.string().max(400), ...box,
    size: z.number(), weight: z.number().default(600), color: z.string(), align: z.enum(["left", "center", "right"]).default("left"),
    font: z.enum(["sans", "serif"]).default("sans"), uppercase: z.boolean().default(false), tracking: z.number().default(0),
    bg: z.string().optional(), radius: z.number().default(0), padX: z.number().default(0), lineHeight: z.number().default(1.1), locked: z.boolean().default(false),
    outline: z.boolean().optional() }),
]);
export type Layer = z.infer<typeof LayerSchema>;

export const DesignDocSchema = z.object({
  w: z.number(), h: z.number(), size: z.enum(["square", "portrait", "story"]), template: z.enum(TEMPLATES),
  layers: z.array(LayerSchema),
});
export type DesignDoc = z.infer<typeof DesignDocSchema>;

export interface ComposeInput {
  template: TemplateKey;
  size: SizeKey;
  sceneRef: string;
  /** Second scene (before/after: the "before" image). */
  sceneRef2?: string;
  productRef: string;
  brand: string;
  direction: Direction;
  price?: string;
  offer?: string;
  logoRef?: string;
  /** The scene already shows the real product (Muse Image edit), so no separate product layer is placed. */
  productInScene?: boolean;
}

const CTA_LABEL: Record<(typeof CTA_TYPES)[number], string> = {
  SHOP_NOW: "Shop now", LEARN_MORE: "Learn more", SIGN_UP: "Sign up", GET_OFFER: "Get offer", ORDER_NOW: "Order now", SEE_MORE: "See more",
};

/** Lays out one design. Every template keeps the product photo intact and the text as live type. */
export function compose(i: ComposeInput): DesignDoc {
  if (i.direction.format && i.direction.format !== "classic") return composeFormat(i, i.direction.format);
  const { w, h } = SIZES[i.size];
  const s = w / 1080; // scale unit
  const pad = 72 * s;
  const tall = h / w;
  const p = i.direction.palette;
  const light = (c: string) => { const n = parseInt(c.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6; };
  const onBase = light(p.base) ? p.ink : "#ffffff";
  const layers: Layer[] = [];
  const add = <T extends Layer>(l: T) => { layers.push(l); return l; };
  const cta = (x: number, y: number, color = p.base, bg = p.accent) => add({ id: "cta", kind: "text", role: "cta", text: CTA_LABEL[i.direction.cta], x, y, w: 300 * s, h: 88 * s,
    size: 34 * s, weight: 700, color, align: "center", font: "sans", uppercase: false, tracking: 0, bg, radius: 44 * s, padX: 0, lineHeight: 88 * s / (34 * s), locked: false });
  const brand = (x: number, y: number, color: string, align: "left" | "center" = "left", width = 500 * s) => {
    if (i.logoRef) {
      // The real logo on a small white chip, so it reads on any background.
      const lw = 210 * s, lh = 64 * s, lx = align === "center" ? x + (width - lw) / 2 : x, ly = y - 12 * s;
      add({ id: "logo-chip", kind: "rect", role: "chip", x: lx, y: ly, w: lw, h: lh, fill: "#ffffff", angle: 180, radius: 16 * s, opacity: 0.96, shadow: false, locked: false });
      return add({ id: "brand", kind: "image", role: "logo", ref: i.logoRef, x: lx + 18 * s, y: ly + 10 * s, w: lw - 36 * s, h: lh - 20 * s, fit: "contain", radius: 0, shadow: false, opacity: 1, locked: false });
    }
    return add({ id: "brand", kind: "text", role: "brand", text: i.brand, x, y, w: width, h: 40 * s,
      size: 26 * s, weight: 700, color, align, font: "sans", uppercase: true, tracking: 0.28, radius: 0, padX: 0, lineHeight: 1.2, locked: false });
  };
  const price = (x: number, y: number, color: string, bg?: string) => i.price ? add({ id: "price", kind: "text", role: "price", text: i.price, x, y, w: 260 * s, h: 64 * s,
    size: 38 * s, weight: 700, color, align: "center", font: "sans", uppercase: false, tracking: 0, bg, radius: 32 * s, padX: 0, lineHeight: 64 / 38, locked: false }) : undefined;
  const offer = (x: number, y: number) => i.offer ? add({ id: "offer", kind: "text", role: "offer", text: i.offer, x, y, w: 420 * s, h: 56 * s,
    size: 26 * s, weight: 700, color: p.base, align: "center", font: "sans", uppercase: true, tracking: 0.08, bg: p.accent, radius: 28 * s, padX: 0, lineHeight: 56 / 26, locked: false }) : undefined;

  if (i.template === "hero") {
    add({ id: "scene", kind: "image", role: "scene", ref: i.sceneRef, x: 0, y: 0, w, h, fit: "cover", radius: 0, shadow: false, opacity: 1, locked: false });
    add({ id: "scrim", kind: "rect", role: "scrim", x: 0, y: h * 0.45, w, h: h * 0.55, fill: p.base, fill2: `${p.base}00`, angle: 0, radius: 0, opacity: 0.92, shadow: false, locked: false });
    const ty = h * (tall > 1.5 ? 0.62 : 0.6);
    if (!i.productInScene) {
      // No product in the scene: the real photo sits on a clean card between the brand line and the headline.
      const top = pad * 0.8 + 76 * s, bottom = ty - 36 * s;
      const chh = bottom - top, cww = Math.min(w * 0.66, chh * (tall > 1.5 ? 0.95 : 1.05));
      add({ id: "card", kind: "rect", role: "card", x: (w - cww) / 2, y: top, w: cww, h: chh, fill: "#ffffff", angle: 180, radius: 32 * s, opacity: 1, shadow: true, locked: false });
      add({ id: "product", kind: "image", role: "product", ref: i.productRef, x: (w - cww) / 2 + 28 * s, y: top + 28 * s, w: cww - 56 * s, h: chh - 56 * s, fit: "contain", radius: 0, shadow: false, opacity: 1, locked: false });
    }
    add({ id: "headline", kind: "text", role: "headline", text: i.direction.headline, x: pad, y: ty, w: w - 2 * pad, h: 150 * s, size: 72 * s, weight: 750, color: p.ink, align: "left", font: "sans", uppercase: false, tracking: -0.02, radius: 0, padX: 0, lineHeight: 1.04, locked: false });
    add({ id: "subline", kind: "text", role: "subline", text: i.direction.subline, x: pad, y: ty + 165 * s, w: w - 2 * pad, h: 80 * s, size: 34 * s, weight: 450, color: p.ink, align: "left", font: "sans", uppercase: false, tracking: 0, radius: 0, padX: 0, lineHeight: 1.25, locked: false });
    cta(pad, h - pad - 88 * s);
    price(w - pad - 260 * s, h - pad - 76 * s, p.ink);
    brand(pad, pad * 0.8, p.accent);
    offer(w - pad - 420 * s, pad * 0.7);
  } else if (i.template === "split") {
    const panelH = tall > 1.5 ? h * 0.42 : tall > 1.1 ? h * 0.4 : h;
    const panelW = tall > 1.1 ? w : w * 0.46;
    const sceneTop = tall > 1.1 ? panelH : 0;
    add({ id: "scene", kind: "image", role: "scene", ref: i.sceneRef, x: tall > 1.1 ? 0 : panelW, y: sceneTop, w: tall > 1.1 ? w : w - panelW, h: tall > 1.1 ? h - panelH : h, fit: "cover", radius: 0, shadow: false, opacity: 1, locked: false });
    add({ id: "panel", kind: "rect", role: "panel", x: 0, y: 0, w: panelW, h: panelH, fill: p.base, angle: 180, radius: 0, opacity: 1, shadow: false, locked: false });
    const pw = tall > 1.1 ? w * 0.62 : (w - panelW) * 0.8;
    const pBoxH = tall > 1.1 ? (h - panelH) * 0.78 : h * 0.62;
    if (!i.productInScene) {
      const px = tall > 1.1 ? (w - pw) / 2 : panelW + ((w - panelW) - pw) / 2, py = tall > 1.1 ? panelH + (h - panelH - pBoxH) / 2 : (h - pBoxH) / 2;
      add({ id: "card", kind: "rect", role: "card", x: px, y: py, w: pw, h: pBoxH, fill: "#ffffff", angle: 180, radius: 32 * s, opacity: 1, shadow: true, locked: false });
      add({ id: "product", kind: "image", role: "product", ref: i.productRef, x: px + 28 * s, y: py + 28 * s, w: pw - 56 * s, h: pBoxH - 56 * s, fit: "contain", radius: 0, shadow: false, opacity: 1, locked: false });
    }
    const tw = panelW - 2 * pad;
    brand(pad, pad, p.accent, "left", tw);
    add({ id: "headline", kind: "text", role: "headline", text: i.direction.headline, x: pad, y: pad + 70 * s, w: tw, h: 230 * s, size: (tall > 1.1 ? 76 : 64) * s, weight: 750, color: p.ink, align: "left", font: "serif", uppercase: false, tracking: -0.01, radius: 0, padX: 0, lineHeight: 1.05, locked: false });
    const subY = tall > 1.1 && tall <= 1.5 ? pad + 200 * s : pad + 310 * s; // 4:5 panel is short: headline runs on one line
    add({ id: "subline", kind: "text", role: "subline", text: i.direction.subline, x: pad, y: subY, w: tw, h: 110 * s, size: 32 * s, weight: 450, color: p.ink, align: "left", font: "sans", uppercase: false, tracking: 0, radius: 0, padX: 0, lineHeight: 1.3, locked: false });
    if (tall > 1.1) { cta(w - pad - 300 * s, panelH - pad - 88 * s); price(pad, panelH - pad - 76 * s, p.base, p.ink); }
    else { price(pad, h - pad - 190 * s, p.base, p.ink); cta(pad, h - pad - 88 * s); }
    offer(tall > 1.1 ? pad : panelW + 40 * s, tall > 1.1 ? h - pad - 56 * s : pad);
  } else {
    // card: scene softened behind a white product card, copy beneath
    add({ id: "scene", kind: "image", role: "scene", ref: i.sceneRef, x: 0, y: 0, w, h, fit: "cover", radius: 0, shadow: false, opacity: 1, locked: false });
    add({ id: "scrim", kind: "rect", role: "scrim", x: 0, y: 0, w, h, fill: p.base, angle: 180, radius: 0, opacity: 0.42, shadow: false, locked: false });
    // Stack from the bottom up so nothing collides at any size: brand, CTA, subline, then the card fills the rest.
    const brandY = h - pad * 0.7 - 34 * s;
    const ctaY = brandY - 28 * s - 88 * s;
    const subY = ctaY - 24 * s - 88 * s;
    const cy = tall > 1.5 ? h * 0.12 : pad;
    const ch = subY - 32 * s - cy;
    const cw = Math.min(w - 2 * pad, ch * (tall > 1.5 ? 0.82 : 1.0));
    const cx = (w - cw) / 2;
    add({ id: "card", kind: "rect", role: "card", x: cx, y: cy, w: cw, h: ch, fill: "#ffffff", angle: 180, radius: 36 * s, opacity: 1, shadow: true, locked: false });
    add({ id: "product", kind: "image", role: "product", ref: i.productRef, x: cx + 36 * s, y: cy + 36 * s, w: cw - 72 * s, h: ch - 140 * s, fit: "contain", radius: 0, shadow: false, opacity: 1, locked: false });
    add({ id: "headline", kind: "text", role: "headline", text: i.direction.headline, x: cx + 40 * s, y: cy + ch - 88 * s, w: cw - 80 * s - (i.price ? 230 * s : 0), h: 60 * s, size: 38 * s, weight: 750, color: "#111111", align: "left", font: "sans", uppercase: false, tracking: -0.01, radius: 0, padX: 0, lineHeight: 1.1, locked: false });
    if (i.price) add({ id: "price", kind: "text", role: "price", text: i.price, x: cx + cw - 40 * s - 220 * s, y: cy + ch - 92 * s, w: 220 * s, h: 60 * s, size: 36 * s, weight: 700, color: "#111111", align: "right", font: "sans", uppercase: false, tracking: 0, radius: 0, padX: 0, lineHeight: 60 / 36, locked: false });
    add({ id: "subline", kind: "text", role: "subline", text: i.direction.subline, x: pad, y: subY, w: w - 2 * pad, h: 88 * s, size: 36 * s, weight: 600, color: onBase, align: "center", font: "sans", uppercase: false, tracking: 0, radius: 0, padX: 0, lineHeight: 1.25, locked: false });
    cta((w - 300 * s) / 2, ctaY);
    brand(0, brandY, onBase, "center", w);
    offer((w - 420 * s) / 2, cy - 28 * s);
  }
  return { w, h, size: i.size, template: i.template, layers };
}

/**
 * Concept formats. Text sits inside Reels/Stories safe zones on 9:16 (top 14% and bottom 25% kept clear of key text).
 * Nothing here invents social proof: post cards carry no like counts, and quotes come only from real customers (checked upstream).
 */
function composeFormat(i: ComposeInput, f: Exclude<FormatKey, "classic">): DesignDoc {
  const { w, h } = SIZES[i.size];
  const s = w / 1080, pad = 72 * s, tall = h / w;
  const d = i.direction, p = d.palette, c = d.copy ?? FormatCopySchema.parse({});
  const top = tall > 1.5 ? h * 0.13 : pad; // clear of the Stories header
  const bottom = tall > 1.5 ? h * 0.78 : h - pad; // clear of the Reels caption area
  const light = (x: string) => { const n = parseInt(x.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6; };
  const onBase = light(p.base) ? p.ink : "#ffffff";
  const layers: Layer[] = [];
  const T = (o: Partial<Extract<Layer, { kind: "text" }>> & { id: string; text: string; x: number; y: number; w: number; h: number; size: number }) =>
    layers.push({ kind: "text", role: "body", weight: 600, color: "#111111", align: "left", font: "sans", uppercase: false, tracking: 0, radius: 0, padX: 0, lineHeight: 1.2, locked: false, outline: false, ...o } as Layer);
  const R = (o: Partial<Extract<Layer, { kind: "rect" }>> & { id: string; x: number; y: number; w: number; h: number; fill: string }) =>
    layers.push({ kind: "rect", role: "panel", angle: 180, radius: 0, opacity: 1, shadow: false, locked: false, ...o } as Layer);
  const I = (o: Partial<Extract<Layer, { kind: "image" }>> & { id: string; ref: string; x: number; y: number; w: number; h: number }) =>
    layers.push({ kind: "image", role: "product", fit: "contain", radius: 0, shadow: false, opacity: 1, locked: false, ...o } as Layer);
  const ctaLabel = CTA_LABEL[d.cta];
  const cta = (x: number, y: number, bg = p.accent, color = light(p.accent) ? "#111111" : "#ffffff") => T({ id: "cta", role: "cta", text: ctaLabel, x, y, w: 300 * s, h: 88 * s, size: 34 * s, weight: 700, color, bg, radius: 44 * s, align: "center", lineHeight: 88 / 34 });
  const brandMark = (x: number, y: number, color: string, align: "left" | "center" | "right" = "left", width = 420 * s) => {
    if (i.logoRef) {
      const lw = 190 * s, lh = 58 * s, lx = align === "center" ? x + (width - lw) / 2 : align === "right" ? x + width - lw : x;
      R({ id: "logo-chip", role: "chip", x: lx, y: y - 10 * s, w: lw, h: lh, fill: "#ffffff", radius: 14 * s, opacity: 0.96 });
      I({ id: "brand", role: "logo", ref: i.logoRef, x: lx + 16 * s, y: y - 1 * s, w: lw - 32 * s, h: lh - 18 * s });
    } else T({ id: "brand", role: "brand", text: i.brand, x, y, w: width, h: 40 * s, size: 26 * s, weight: 700, color, align, uppercase: true, tracking: 0.24 });
  };
  const product = (x: number, y: number, ww: number, hh: number, card = true) => {
    if (card) R({ id: "card", role: "card", x, y, w: ww, h: hh, fill: "#ffffff", radius: 28 * s, shadow: true });
    I({ id: "product", ref: i.productRef, x: x + 24 * s, y: y + 24 * s, w: ww - 48 * s, h: hh - 48 * s });
  };

  if (f === "notes") {
    R({ id: "bg", x: 0, y: 0, w, h, fill: "#fbfaf7" });
    T({ id: "notes-bar", text: "‹ Notes", x: pad, y: top, w: 400 * s, h: 50 * s, size: 34 * s, weight: 500, color: "#d49a1b" });
    T({ id: "headline", role: "headline", text: d.headline, x: pad, y: top + 90 * s, w: w - 2 * pad, h: 150 * s, size: 64 * s, weight: 800, lineHeight: 1.08 });
    const lines = (c.lines.length ? c.lines : [d.subline]).slice(0, 5).map((l) => `• ${l}`).join("\n");
    const prodH = tall > 1.1 ? h * 0.3 : h * 0.34;
    T({ id: "body", text: lines, x: pad, y: top + 260 * s, w: w - 2 * pad, h: bottom - (top + 260 * s) - prodH - 40 * s, size: 40 * s, weight: 450, color: "#2b2b2b", lineHeight: 1.45 });
    product(w - pad - prodH * 1.05, bottom - prodH, prodH * 1.05, prodH);
    cta(pad, bottom - 88 * s, "#111111", "#ffffff");
    brandMark(pad, bottom - 88 * s - 80 * s, "#111111");
  } else if (f === "tweet") {
    R({ id: "bg", x: 0, y: 0, w, h, fill: p.base });
    const cx = pad * 0.8, cw = w - 2 * cx, cy = top, ch = bottom - top - 120 * s;
    R({ id: "post", role: "card", x: cx, y: cy, w: cw, h: ch, fill: "#ffffff", radius: 36 * s, shadow: true });
    R({ id: "avatar", role: "chip", x: cx + 44 * s, y: cy + 44 * s, w: 92 * s, h: 92 * s, fill: p.accent, radius: 46 * s });
    if (i.logoRef) I({ id: "avatar-logo", role: "logo", ref: i.logoRef, x: cx + 52 * s, y: cy + 52 * s, w: 76 * s, h: 76 * s });
    T({ id: "name", text: c.author || i.brand, x: cx + 160 * s, y: cy + 48 * s, w: cw - 220 * s, h: 44 * s, size: 34 * s, weight: 750 });
    T({ id: "handle", text: `@${(c.author || i.brand).toLowerCase().replace(/[^a-z0-9]+/g, "")}`, x: cx + 160 * s, y: cy + 92 * s, w: cw - 220 * s, h: 40 * s, size: 28 * s, weight: 400, color: "#6b6b6b" });
    T({ id: "headline", role: "headline", text: c.quote || d.headline, x: cx + 44 * s, y: cy + 176 * s, w: cw - 88 * s, h: 240 * s, size: 46 * s, weight: 500, lineHeight: 1.3 });
    const py = cy + 440 * s, ph = ch - (py - cy) - 44 * s;
    R({ id: "media", role: "card", x: cx + 44 * s, y: py, w: cw - 88 * s, h: ph, fill: "#f1f1f1", radius: 24 * s });
    I({ id: "product", ref: i.productRef, x: cx + 64 * s, y: py + 20 * s, w: cw - 128 * s, h: ph - 40 * s });
    cta((w - 300 * s) / 2, bottom - 88 * s + 20 * s);
  } else if (f === "testimonial") {
    R({ id: "bg", x: 0, y: 0, w, h, fill: p.base });
    T({ id: "quote-mark", text: "“", x: pad, y: top - 20 * s, w: 200 * s, h: 200 * s, size: 220 * s, weight: 700, color: p.accent, font: "serif", lineHeight: 1 });
    const qh = tall > 1.1 ? h * 0.3 : h * 0.34;
    T({ id: "headline", role: "headline", text: c.quote || d.headline, x: pad, y: top + 150 * s, w: w - 2 * pad, h: qh, size: (tall > 1.1 ? 60 : 54) * s, weight: 500, color: onBase, font: "serif", lineHeight: 1.22 });
    T({ id: "author", text: c.author ? `— ${c.author}` : "— A customer", x: pad, y: top + 150 * s + qh + 10 * s, w: w - 2 * pad, h: 44 * s, size: 30 * s, weight: 500, color: onBase });
    const py = top + 150 * s + qh + 80 * s, ph = bottom - py - 110 * s;
    if (ph > 160 * s) product(pad, py, Math.min(w - 2 * pad, ph * 1.3), ph);
    cta(pad, bottom - 88 * s);
    brandMark(w - pad - 420 * s, bottom - 70 * s, onBase, "right");
  } else if (f === "versus") {
    R({ id: "bg", x: 0, y: 0, w, h, fill: "#ffffff" });
    T({ id: "headline", role: "headline", text: d.headline, x: pad, y: top, w: w - 2 * pad, h: 150 * s, size: 64 * s, weight: 800, lineHeight: 1.06 });
    const rows = (c.rows.length ? c.rows : [{ label: "", us: d.subline, them: "" }]).slice(0, 5);
    const colW = (w - 2 * pad) / 3, ty = top + 190 * s;
    const prodH = tall > 1.1 ? 300 * s : 220 * s;
    R({ id: "us-col", role: "panel", x: pad + colW, y: ty, w: colW, h: 90 * s + rows.length * 110 * s, fill: `${p.accent}22`, radius: 24 * s });
    T({ id: "us-head", text: i.brand, x: pad + colW, y: ty + 20 * s, w: colW, h: 50 * s, size: 32 * s, weight: 800, align: "center", color: "#111111" });
    T({ id: "them-head", text: c.them || "Others", x: pad + 2 * colW, y: ty + 20 * s, w: colW, h: 50 * s, size: 32 * s, weight: 600, align: "center", color: "#8a8a8a" });
    rows.forEach((r, k) => {
      const y = ty + 90 * s + k * 110 * s;
      R({ id: `rule-${k}`, x: pad, y: y - 2, w: w - 2 * pad, h: 2, fill: "#e8e8e8" });
      T({ id: `row-${k}-label`, text: r.label, x: pad, y: y + 22 * s, w: colW - 10 * s, h: 70 * s, size: 28 * s, weight: 600, color: "#555555" });
      T({ id: `row-${k}-us`, text: r.us, x: pad + colW, y: y + 22 * s, w: colW, h: 70 * s, size: 30 * s, weight: 750, align: "center" });
      T({ id: `row-${k}-them`, text: r.them, x: pad + 2 * colW, y: y + 22 * s, w: colW, h: 70 * s, size: 30 * s, weight: 450, align: "center", color: "#8a8a8a" });
    });
    const py = Math.min(bottom - 88 * s - prodH - 30 * s, ty + 90 * s + rows.length * 110 * s + 40 * s);
    I({ id: "product", ref: i.productRef, x: (w - prodH * 1.2) / 2, y: py, w: prodH * 1.2, h: prodH });
    cta((w - 300 * s) / 2, bottom - 88 * s);
  } else if (f === "beforeafter") {
    const vertical = tall > 1.1;
    const aW = vertical ? w : w / 2, aH = vertical ? h / 2 : h;
    I({ id: "scene2", role: "scene", ref: i.sceneRef2 ?? i.sceneRef, x: 0, y: 0, w: aW, h: aH, fit: "cover" });
    I({ id: "scene", role: "scene", ref: i.sceneRef, x: vertical ? 0 : aW, y: vertical ? aH : 0, w: aW, h: aH, fit: "cover" });
    const chip = (id: string, text: string, x: number, y: number, bg: string, color: string) => T({ id, text, x, y, w: 300 * s, h: 64 * s, size: 30 * s, weight: 800, color, bg, radius: 32 * s, align: "center", uppercase: true, tracking: 0.1, lineHeight: 64 / 30 });
    chip("before", c.before || "Before", pad, vertical ? top : pad, "#111111cc", "#ffffff");
    chip("after", c.after || "After", vertical ? pad : aW + pad, vertical ? aH + 100 * s : pad, p.accent, light(p.accent) ? "#111111" : "#ffffff");
    T({ id: "headline", role: "headline", text: d.headline, x: pad, y: (vertical ? aH : h * 0.5) - 60 * s, w: w - 2 * pad, h: 120 * s, size: 52 * s, weight: 800, color: "#ffffff", align: "center", bg: `${p.base}e6`, radius: 24 * s, lineHeight: 120 / 52 * 0.98 });
    cta((w - 300 * s) / 2, bottom - 88 * s);
    brandMark(w - pad - 420 * s, vertical ? aH + 112 * s : h - pad - 40 * s, "#ffffff", "right");
  } else if (f === "offer") {
    R({ id: "bg", x: 0, y: 0, w, h, fill: p.base });
    T({ id: "offer", role: "offer", text: i.offer || d.hook, x: pad, y: top, w: w - 2 * pad, h: 220 * s, size: 120 * s, weight: 900, color: p.accent, lineHeight: 0.95, uppercase: true, tracking: -0.02 });
    T({ id: "headline", role: "headline", text: d.headline, x: pad, y: top + 240 * s, w: w - 2 * pad, h: 120 * s, size: 50 * s, weight: 700, color: onBase, lineHeight: 1.1 });
    const py = top + 400 * s, ph = bottom - py - 120 * s;
    product(pad + 40 * s, py, w - 2 * pad - 80 * s, ph);
    if (i.price) T({ id: "price", role: "price", text: i.price, x: w - pad - 260 * s, y: bottom - 76 * s, w: 260 * s, h: 64 * s, size: 40 * s, weight: 800, color: onBase, align: "right", lineHeight: 64 / 40 });
    cta(pad, bottom - 88 * s);
  } else if (f === "meme") {
    I({ id: "scene", role: "scene", ref: i.sceneRef, x: 0, y: 0, w, h, fit: "cover" });
    const meme = (id: string, text: string, y: number) => T({ id, text, x: pad * 0.6, y, w: w - 1.2 * pad, h: 220 * s, size: 76 * s, weight: 900, color: "#ffffff", align: "center", uppercase: true, outline: true, lineHeight: 1.02, font: "sans" });
    meme("headline", c.top || d.headline, top);
    meme("subline", c.bottom || d.subline, bottom - 220 * s - 110 * s);
    cta((w - 300 * s) / 2, bottom - 88 * s);
  } else {
    // ugc: lifestyle scene with the creator-style caption sticker
    I({ id: "scene", role: "scene", ref: i.sceneRef, x: 0, y: 0, w, h, fit: "cover" });
    const sticker = c.sticker || d.hook, perLine = Math.floor((w - 1.6 * pad - 48 * s) / (48 * s * 0.52)), nLines = Math.max(1, Math.ceil(sticker.length / perLine));
    T({ id: "headline", role: "headline", text: sticker, x: pad * 0.8, y: top + (tall > 1.5 ? h * 0.12 : 40 * s), w: w - 1.6 * pad, h: nLines * 48 * s * 1.25 + 36 * s, size: 48 * s, weight: 700, color: "#111111", bg: "#ffffff", radius: 18 * s, align: "center", padX: 24 * s, lineHeight: 1.25 });
    R({ id: "scrim", role: "scrim", x: 0, y: h * 0.7, w, h: h * 0.3, fill: "#000000", fill2: "#00000000", angle: 0, opacity: 0.55 });
    T({ id: "subline", role: "subline", text: d.subline, x: pad, y: bottom - 200 * s, w: w - 2 * pad, h: 90 * s, size: 34 * s, weight: 600, color: "#ffffff" });
    cta(pad, bottom - 88 * s);
    brandMark(w - pad - 420 * s, bottom - 70 * s, "#ffffff", "right");
  }
  return { w, h, size: i.size, template: "hero", layers };
}

// ── SVG rendering (shared by server and browser) ────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONTS = { sans: "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif", serif: "Georgia, 'Times New Roman', serif" };

/** One SVG for a design. `href` maps an image ref to something the renderer can load (data: URI or URL). */
export function designToSvg(doc: DesignDoc, href: (ref: string) => string, o: { hide?: string[] } = {}): string {
  const defs: string[] = [
    `<filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="${doc.w * 0.012}" stdDeviation="${doc.w * 0.018}" flood-color="#000" flood-opacity="0.28"/></filter>`,
  ];
  const body: string[] = [];
  for (const l of doc.layers) {
    if (o.hide?.includes(l.id)) continue;
    if (l.kind === "image") {
      const clip = l.radius ? (defs.push(`<clipPath id="c-${l.id}"><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${l.radius}"/></clipPath>`), ` clip-path="url(#c-${l.id})"`) : "";
      body.push(`<image data-layer="${l.id}" href="${esc(href(l.ref))}" x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" preserveAspectRatio="xMidYMid ${l.fit === "cover" ? "slice" : "meet"}" opacity="${l.opacity}"${clip}${l.shadow ? ` filter="url(#sh)"` : ""}/>`);
    } else if (l.kind === "rect") {
      let fill = l.fill;
      if (l.fill2) {
        const a = (l.angle * Math.PI) / 180;
        defs.push(`<linearGradient id="g-${l.id}" x1="${0.5 - Math.sin(a) / 2}" y1="${0.5 + Math.cos(a) / 2}" x2="${0.5 + Math.sin(a) / 2}" y2="${0.5 - Math.cos(a) / 2}"><stop offset="0" stop-color="${l.fill}"/><stop offset="1" stop-color="${l.fill2}"/></linearGradient>`);
        fill = `url(#g-${l.id})`;
      }
      body.push(`<rect data-layer="${l.id}" x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${l.radius}" fill="${fill}" opacity="${l.opacity}"${l.shadow ? ` filter="url(#sh)"` : ""}/>`);
    } else {
      const style = [
        `width:${l.w}px`, `height:${l.h}px`, `font-family:${FONTS[l.font]}`, `font-size:${l.size}px`, `font-weight:${l.weight}`,
        `color:${l.color}`, `text-align:${l.align}`, `line-height:${l.lineHeight}`, `letter-spacing:${l.tracking}em`,
        l.uppercase ? "text-transform:uppercase" : "", l.bg ? `background:${l.bg}` : "", l.radius ? `border-radius:${l.radius}px` : "",
        l.padX ? `padding:0 ${l.padX}px` : "", "box-sizing:border-box", "overflow:hidden", "margin:0", "word-wrap:break-word",
        "-webkit-font-smoothing:antialiased", "white-space:pre-line",
        l.outline ? `text-shadow:0 0 ${l.size * 0.06}px #000,0 ${l.size * 0.04}px 0 #000,0 -${l.size * 0.04}px 0 #000,${l.size * 0.04}px 0 0 #000,-${l.size * 0.04}px 0 0 #000` : "",
      ].filter(Boolean).join(";");
      body.push(`<foreignObject data-layer="${l.id}" x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}"><div xmlns="http://www.w3.org/1999/xhtml" style="${esc(style)}">${esc(l.text)}</div></foreignObject>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${doc.w} ${doc.h}" width="${doc.w}" height="${doc.h}"><defs>${defs.join("")}</defs>${body.join("")}</svg>`;
}

/** Re-lays out a design in another size or template, keeping the person's text edits. */
export function relayout(doc: DesignDoc, input: Omit<ComposeInput, "template" | "size">, to: { template?: TemplateKey; size?: SizeKey }): DesignDoc {
  const next = compose({ ...input, template: to.template ?? doc.template, size: to.size ?? doc.size });
  const texts = new Map(doc.layers.filter((l) => l.kind === "text").map((l) => [l.id, (l as Extract<Layer, { kind: "text" }>).text]));
  return { ...next, layers: next.layers.map((l) => (l.kind === "text" && texts.has(l.id) ? { ...l, text: texts.get(l.id)! } : l)) };
}

// ── Autopilot: from a website to a running, learning campaign ───────────────

/** What the agent concluded about a brand from its website. */
export const SiteProfileSchema = z.object({
  brand: z.object({
    name: z.string().max(80),
    oneLiner: z.string().max(200).catch(""),
    voice: z.string().max(300).catch(""),
    values: z.array(z.string().max(80)).max(6).catch([]),
    palette: z.object({ base: hex, accent: hex, ink: hex }).catch({ base: "#ffffff", accent: "#0071e3", ink: "#111111" }),
  }),
  category: z.string().max(120).catch(""),
  audience: z.object({
    summary: z.string().max(400).catch(""),
    ageMin: z.number().int().min(18).max(65).catch(18),
    ageMax: z.number().int().min(18).max(65).catch(65),
    countries: z.array(z.string().length(2)).min(1).max(5).catch(["IN"]),
  }),
  heroProduct: z.number().int().min(0).catch(0),
  heroWhy: z.string().max(300).catch(""),
  competitors: z.array(z.string().max(80)).max(6).catch([]),
  offer: z.string().max(80).catch(""),
  goal: z.string().max(200).catch(""),
  notes: z.string().max(600).catch(""),
});
export type SiteProfile = z.infer<typeof SiteProfileSchema>;

export interface AdPerformance {
  adId: string; direction: number; title: string; status: string;
  impressions: number; reach: number; clicks: number; ctr: number; cpc: number; spend: number; frequency: number;
  /** Sales campaigns (Meta Pixel): purchases, cost per purchase and return on ad spend. */
  purchases?: number; cpa?: number; roas?: number;
}
export interface PerformanceSnapshot { at: string; currency: string; ads: AdPerformance[]; totals: { impressions: number; clicks: number; spend: number; ctr: number } }

/** What the agent took away from one look at the numbers. */
export const LearnSchema = z.object({
  summary: z.string().max(600),
  winner: z.number().int().nullable().catch(null),
  confidence: z.enum(["low", "medium", "high"]).catch("low"),
  learnings: z.array(z.string().max(240)).max(6).catch([]),
  nextIdea: z.object({
    basedOn: z.number().int().min(0),
    title: z.string().max(60), angle: z.string().max(240), hook: z.string().max(120),
    headline: z.string().max(60), subline: z.string().max(90), primaryText: z.string().max(280), scenePrompt: z.string().max(800),
    why: z.string().max(300).catch(""),
  }).nullable().catch(null),
});
export type Learn = z.infer<typeof LearnSchema>;
export type Learning = Learn & { at: string; impressions: number };

export const MOVE_KINDS = ["go_live", "pause_ad", "scale_budget", "new_variant"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];
/** A change the agent wants to make to the live campaign. Nothing that spends or changes a live ad runs without approval. */
export interface Move {
  id: string; kind: MoveKind; title: string; why: string;
  params: { adId?: string; direction?: number; dailyBudget?: number; idea?: NonNullable<Learn["nextIdea"]> };
  status: "pending" | "running" | "done" | "dismissed" | "failed";
  createdAt: string; decidedAt?: string; decidedBy?: string; result?: string;
}

// ── Concept board and brand memory ──────────────────────────────────────────

export const ConceptScoreSchema = z.object({
  overall: z.number().min(0).max(1).catch(0.5),
  scrollStop: z.number().min(0).max(1).catch(0.5),
  clarity: z.number().min(0).max(1).catch(0.5),
  product: z.number().min(0).max(1).catch(0.5),
  text: z.number().min(0).max(1).catch(0.5),
  brand: z.number().min(0).max(1).catch(0.5),
  notes: z.string().max(300).catch(""),
});
export type ConceptScore = z.infer<typeof ConceptScoreSchema>;

/** One idea on the concept board: a direction in a format, rendered square and pre-scored by Muse Spark. */
export type Concept = Direction & {
  id: string; format: FormatKey; sceneRef?: string; sceneRef2?: string; productInScene?: boolean; renderRef?: string;
  score?: ConceptScore; recommended?: boolean; addedAs?: number; remixOf?: { adId: string; pageName: string }; createdAt: string;
  design?: DesignInfo; history?: string[];
};

export const BrandMemorySchema = z.object({
  summary: z.string().max(800).catch(""),
  winners: z.array(z.string().max(240)).max(6).catch([]),
  losers: z.array(z.string().max(240)).max(6).catch([]),
  doMore: z.array(z.string().max(240)).max(6).catch([]),
  avoid: z.array(z.string().max(240)).max(6).catch([]),
});
export type BrandMemory = z.infer<typeof BrandMemorySchema>;

/** Muse Spark's retoucher check on a generated design: is every word exact, is it our product, is it free of AI artefacts. */
export const DesignCheckSchema = z.object({
  texts: z.array(z.object({ expected: z.string(), found: z.string().catch(""), exact: z.boolean().catch(false) })).catch([]),
  extraText: z.array(z.string()).max(8).catch([]),
  product: z.number().min(0).max(1).catch(0.5),
  quality: z.number().min(0).max(1).catch(0.5),
  artifacts: z.array(z.string().max(160)).max(6).catch([]),
  fix: z.string().max(300).catch(""),
});
export type DesignCheck = z.infer<typeof DesignCheckSchema> & { pass: boolean };
export interface DesignInfo { mode: "generated" | "art"; style: VisualStyle; check?: DesignCheck; attempts: number; prompt: string }
