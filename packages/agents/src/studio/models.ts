import { z } from "zod";
import {
  AdAnalysisSchema, DirectionSchema, InsightsSchema, LearnSchema, SiteProfileSchema,
  BrandMemorySchema, ConceptScoreSchema, DesignCheckSchema, STYLE_BLOCK, FORMATS, FormatCopySchema, VISUAL_STYLES, VoiceSchema,
  type AdAnalysis, type BrandMemory, type DesignCheck, type ConceptScore, type FormatKey, type Learn, type PerformanceSnapshot, type SiteProfile, type Voice, type Brief, type CompetitorAd, type Direction, type Insights, type ReelShot, type Rulebook,
} from "@keel/core";
import { callJson, config, editImage, generateImage, inlineImageHref, metaClient, museImage, renderSvgToPng, runTools, type Aspect, type AgentTool, type ImageInput, type ModelCallInfo, type SiteCrawl } from "@keel/meta";
import { rulebookBlock } from "../prompts.ts";

export type StudioCall = (info: ModelCallInfo & { step: string }) => void;

export interface SceneScore { index: number; score: number; product: number; aesthetics: number; layoutFit: number; notes: string }
export interface SceneRanking { scores: SceneScore[]; best: number; fix: string; space: "bottom" | "top" | "left" | "right" | "none" }

/** Everything Studio asks of a model. Real (Meta) and offline (fake) implementations share it. */
export interface StudioModels {
  researchPlan(brief: Brief, brand: string): Promise<{ searchTerms: string[]; competitors: string[]; sites: string[] }>;
  /** The research agent: Muse Wonder with tools (Ad Library search, reading websites, looking at ads), deciding each next step itself. */
  researchLoop(o: { system: string; text: string; tools: AgentTool[]; maxSteps: number; onText: (t: string) => Promise<void> }): Promise<string>;
  analyzeAd(ad: { image?: ImageInput; body?: string; title?: string; pageName: string }): Promise<AdAnalysis>;
  synthesize(brief: Brief, brand: string, ads: CompetitorAd[], notes?: string): Promise<Insights>;
  planDirections(brief: Brief, brand: string, product: ImageInput[], rulebook: Rulebook | undefined, insights: Insights | undefined, extra?: { voice?: Voice; memory?: BrandMemory }): Promise<Direction[]>;
  /** One scene candidate. With a product photo, Muse Image places the real product in it (productInScene). */
  generateScene(direction: Direction, brief: Brief, product: ImageInput[], variant: number): Promise<{ bytes: Buffer; productInScene: boolean }>;
  rankScenes(candidates: ImageInput[], product: ImageInput, direction: Direction): Promise<SceneRanking>;
  refineScene(image: ImageInput, fix: string, brief: Brief): Promise<Buffer>;
  storyboardFrame(shot: ReelShot, direction: Direction, brief: Brief, product: ImageInput[]): Promise<Buffer>;
  critique(design: ImageInput, product: ImageInput, direction: Direction, rulebook?: Rulebook): Promise<{ pass: boolean; score: number; issues: string[] }>;
  /** Autopilot: who the brand is, who it sells to and which product to lead with, from its website. */
  readSite(site: SiteCrawl, images: ImageInput[]): Promise<SiteProfile>;
  /** Autopilot: what the campaign's results say, and one new idea built on what's working. */
  learn(o: { brand: string; product: string; directions: Direction[]; perf: PerformanceSnapshot; history: { at: string; summary: string }[]; insights?: Insights }): Promise<Learn>;
  /** Voice of the customer: personas, pains and the exact words customers use, from real reviews and threads. */
  voiceOfCustomer(o: { brief: Brief; brand: string; quotes: { text: string; source: string }[] }): Promise<Omit<Voice, "quotes">>;
  /** The concept board: many ideas across formats, grounded in research, customer voice and brand memory. */
  planConcepts(o: { brief: Brief; brand: string; product: ImageInput[]; insights?: Insights; voice?: Voice; memory?: BrandMemory; rulebook?: Rulebook; count: number; formats: FormatKey[]; remix?: { image?: ImageInput; analysis?: AdAnalysis; pageName: string } }): Promise<Direction[]>;
  /** Muse Image designs a finished ad from an art brief and references (product photos, logo), at an aspect ratio. */
  designImage(o: { prompt: string; references: ImageInput[]; aspect: Aspect }): Promise<Buffer>;
  /** One precise Muse Image edit of a design (retouch, refine, recompose for another aspect ratio). */
  editDesign(o: { image: ImageInput; instruction: string; references: ImageInput[]; aspect: Aspect; expected: string[] }): Promise<Buffer>;
  /** Muse Spark reads every word on a design and checks the product and artefacts. */
  verifyDesign(design: ImageInput, product: ImageInput, expected: string[], concept: Direction): Promise<Omit<DesignCheck, "pass">>;
  /** Pre-flight: Muse Spark predicts how a rendered concept will do in the feed, before anything is spent. */
  scoreConcept(design: ImageInput, product: ImageInput, concept: Direction): Promise<ConceptScore>;
  /** Brand memory: what the brand's own past ads say works, from their results and Spark's read of each. */
  learnMemory(o: { brand: string; ads: { name: string; analysis?: AdAnalysis; impressions: number; ctr: number; cpc: number; spend: number; purchases?: number; cpa?: number; roas?: number; body?: string; title?: string }[]; learnings: string[] }): Promise<BrandMemory>;
}

// ── prompts ──────────────────────────────────────────────────────────────────

const RESEARCH_PLAN = `You plan competitor research for a Meta ad campaign.
From the brief, list who the product competes with on Facebook and Instagram: well-known brands in that category and market
(include any the brief names), 3-5 short search terms people in the Ad Library would use to find ads in this category, and the official
website address of up to 4 of those competitors (only addresses you are confident are real, as bare domains like "decathlon.in", preferring
the site for the brief's market).
JSON: {"competitors": [string], "searchTerms": [string], "sites": [string]}`;

const ANALYZE_AD = `You are a senior paid-social strategist reviewing ONE competitor ad (screenshot plus its copy, if any).
If it is a competitor's website homepage rather than an ad, review its hero section and messaging the same way (format = "website").
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
- style: the visual language that fits the story and brand, one of ${VISUAL_STYLES.join(", ")} (vary it across the three directions; photo styles for most products)
- visual: the story moment the hero image shows (who, where, what is happening, the emotion), one or two vivid sentences
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

const READ_SITE = `You are a brand strategist on day one with a new client. You get their website: a screenshot of the homepage
(image 1), product photos (the next images, numbered from 0 in the product list), and the text, colours and fonts Keel read from the page.
Work out: the brand (name exactly as the site writes it, a one-line positioning, its voice in a sentence, up to 4 values, and a palette for ads:
base = background, accent = the brand's action colour, ink = text readable on base, all hex, taken from the site), the category,
the most likely audience (summary, age range, up to 3 countries as ISO codes, from the currency, language, shipping and domain),
which product to lead the first campaign with (heroProduct = its index in the list) and why, 3-5 competitors that advertise in this
category in that market, any offer the site is running right now (exactly as written, or empty), the campaign goal, and notes for the
creative team (what to keep, what to avoid). Never invent prices or offers.
JSON: {"brand":{"name","oneLiner","voice","values":[],"palette":{"base","accent","ink"}},"category","audience":{"summary","ageMin","ageMax","countries":[]},"heroProduct","heroWhy","competitors":[],"offer","goal","notes"}`;

const LEARN = `You are the performance strategist on a Meta campaign Keel is running. Each ad is one creative direction.
Read the lifetime results (impressions, link clicks, CTR %, CPC, spend, frequency). Explain in plain English what is working and why,
grounded in the directions' angles and hooks (not just numbers). Say which direction is winning (index) and how confident you are:
low under ~1,000 impressions per ad or when the gap is small, high when the gap is large and the volume is real.
Write up to 4 short, specific learnings. If one direction is clearly ahead, propose ONE new direction (nextIdea) that keeps what makes it work
and tests one new idea (a sharper hook, a new scene, a different proof point); basedOn = the winner's index. Otherwise nextIdea = null.
Never invent claims, prices or offers.
JSON: {"summary","winner": number|null,"confidence":"low"|"medium"|"high","learnings":[string],"nextIdea": {"basedOn","title","angle","hook","headline","subline","primaryText","scenePrompt","why"}|null}`;

const VOICE = `You are a consumer-insights researcher. Below are real things customers wrote (reviews, forum threads, Q&A) about this product or category.
Find who buys it and why: 2-3 personas (a short name like "The monsoon commuter", who they are, their pains, desires and objections, and up to 3 quotes
copied EXACTLY from the material below). Then list up to 10 short phrases customers actually use, verbatim, that would make strong ad hooks.
Never invent quotes or paraphrase them as quotes. If the material is thin, say so in the summary.
JSON: {"summary","personas":[{"name","who","pains":[],"desires":[],"objections":[],"quotes":[]}],"phrases":[]}`;

const CONCEPTS = (n: number, formats: string[]) => `You are the creative director at a performance agency making a concept board of ${n} different Meta static ads (feed, Stories, Reels).
Use the competitor insights, what customers actually say (personas and their phrases), what has worked for this brand before (memory), and the product photos.
Spread the ideas across personas and these formats: ${formats.join(", ")}. Formats:
- classic: a hero image of the product in a scene with a headline
- notes: an iPhone Notes-app screenshot; copy.lines = 3-5 short punchy lines (features, reasons, a mini list)
- tweet: a social post card from the brand; copy.quote = the post text (≤ 200 chars, conversational)
- testimonial: a customer quote card. copy.quote MUST be a real customer quote copied exactly from the material provided, copy.author = its source (e.g. "Amazon review"). If there are no real quotes, don't use this format.
- versus: us vs a generic alternative ("Typical raincoat", never a named competitor); copy.rows = 3-4 {label, us, them} with only facts from the brief or site
- beforeafter: copy.scene2 = the "before" scene (the problem), scenePrompt = the "after" scene with the product; copy.before/after = 1-2 word labels
- offer: only if the brief states an offer; headline supports it
- meme: a relatable situation for the scenePrompt (no product), copy.top / copy.bottom = a meme caption in the audience's voice
- ugc: a creator-style lifestyle scene with the product; copy.sticker = a POV-style caption (e.g. "POV: …")
Choose a visual style for each that fits its story and the brand (vary them across the board): ${VISUAL_STYLES.join(", ")}
(photoreal = studio product photo, lifestyle = candid editorial photo, cinematic = film still, render3d / clay / isometric = 3D, illustration / risograph / papercut / collage = 2D).
For each: title, format, style, visual (the story moment the image shows: who, where, what is happening, the emotion, in one or two vivid sentences), persona, angle, hook, rationale (which insight or customer phrase it uses), scenePrompt (environment only, never the product itself; "" if the format needs none),
headline (≤ 6 words), subline (≤ 12 words), primaryText (≤ 2 short sentences), cta, palette {base, accent, ink} on-brand, copy (as above, other fields empty).
Lead with customers' own words. Never invent claims, prices, discounts, reviews or numbers. Respect the rulebook.
JSON: {"concepts":[ ... ]}`;

const REMIX = `You are a creative director. Image 1 is a competitor's ad that has been running for a long time (so it probably works). Learn its STRUCTURE:
the format, how the hook is built, the layout, the pacing of the copy, the emotional trigger. Then write ONE concept for OUR brand that uses the same structure
with our product, our voice and our own claims. Never copy their words, logo, characters, imagery or brand assets: same skeleton, new everything.
Return it in the concept format (title, format from: ${FORMATS.join(", ")}, persona, angle, hook, rationale = which structural idea you borrowed, scenePrompt, headline, subline, primaryText, cta, palette, copy).
JSON: {"concepts":[ one concept ]}`;

const VERIFY = `You are a meticulous retoucher checking a generated ad before it can run. Image 1 is the REAL product photo, image 2 the ad.
1. Read every piece of text in the ad. For each expected string, report exactly what you found and whether it matches letter for letter
   (case and punctuation may differ slightly; spelling may not). List any other text you see (extraText), ignoring text that is part of the product itself.
2. product 0-1: is it unmistakably the same product as image 1 (shape, colour, logo, proportions), undistorted?
3. quality 0-1: would a top agency ship it (realism or style executed well, light, composition)?
4. artifacts: concrete AI flaws (warped hands, melted objects, gibberish letters, duplicated limbs, broken logo). Empty if none.
5. fix: ONE precise edit instruction that fixes the most important problem (e.g. 'Change the headline text to exactly "Built for the downpour"'), or "".
JSON: {"texts":[{"expected","found","exact"}],"extraText":[],"product","quality","artifacts":[],"fix"}`;

const SCORE = `You are Meta's best creative strategist doing a pre-flight check on a static ad before money is spent. Image 1 is the REAL product photo, image 2 the ad.
Score 0-1: scrollStop (would a thumb stop in a busy feed in 0.5 s: contrast, a human/emotional hook, novelty), clarity (is the message understood in 1 second),
product (is the real product clear and undistorted), text (legible at phone size, not too much, inside safe zones), brand (on-brand, premium, trustworthy).
overall = your honest prediction of relative performance. notes = the single most useful fix, in one sentence.
JSON: {"overall","scrollStop","clarity","product","text","brand","notes"}`;

const MEMORY = `You are the brand's performance strategist. Below are the brand's own past Meta ads with lifetime results and a description of each creative,
plus lessons from campaigns Keel ran. Find what works FOR THIS BRAND: patterns shared by the winners (by CTR, cost per click, purchases/ROAS when present, with
enough impressions to trust), patterns shared by the losers, what to do more of and what to avoid. Be specific (formats, hooks, visuals, copy), evidence-based.
JSON: {"summary","winners":[],"losers":[],"doMore":[],"avoid":[]}`;

const shotPrompt = (d: Direction, extra = "") => [
  d.visual ? `${d.visual} ${d.scenePrompt}` : d.scenePrompt,
  d.style && `Style: ${STYLE_BLOCK[d.style]}`,
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
      z.object({ competitors: z.array(z.string()).max(8).catch([]), searchTerms: z.array(z.string()).max(6).catch([]), sites: z.array(z.string().max(120)).max(6).catch([]) }),
      [`Brand: ${brand}`, `Product: ${brief.productName} (${brief.productUrl})`, `Market: ${brief.countries.join(", ")}`, brief.audience && `Audience: ${brief.audience}`,
        brief.competitors.length ? `Competitors named by the brand: ${brief.competitors.join(", ")}` : ""].filter(Boolean).join("\n"), [], "low"),

    researchLoop: (o) => runTools({ client: metaClient(), model: config.models.wonder, system: o.system, text: o.text, tools: o.tools, maxSteps: o.maxSteps, maxParallel: 3, reasoningEffort: "medium", onText: o.onText, onCall: (i) => onCall?.({ ...i, step: "research" }) }),

    analyzeAd: (ad) => call("analyze", config.models.spark, ANALYZE_AD, AdAnalysisSchema,
      [`Advertiser: ${ad.pageName}`, ad.title && `Headline: ${ad.title}`, ad.body && `Copy: ${ad.body.slice(0, 600)}`].filter(Boolean).join("\n"), ad.image ? [ad.image] : [], "low"),

    synthesize: (brief, brand, ads, notes) => call("insights", config.models.wonder, SYNTHESIZE, InsightsSchema,
      [`Our brand: ${brand}. Product: ${brief.productName}. Audience: ${brief.audience || "not stated"}. Market: ${brief.countries.join(", ")}.`,
        notes ? `The research agent's own notes: ${notes.slice(0, 1500)}` : "",
        "Competitor ads (source \"site\" = the competitor's website homepage, not an ad):", ...ads.map((a) => JSON.stringify({ id: a.id, source: a.source, advertiser: a.pageName, daysRunning: a.daysRunning, copy: a.body?.slice(0, 300), headline: a.title, analysis: a.analysis }))].join("\n"), [], "high"),

    async planDirections(brief, brand, product, rulebook, insights, extra) {
      const out = await call("strategy", config.models.wonder, PLAN_SYSTEM, z.object({ directions: z.array(DirectionSchema).min(1).max(3) }),
        [`Brand: ${brand}`, `Product: ${brief.productName} (${brief.productUrl})`, brief.price && `Price: ${brief.price}`, brief.offer && `Offer: ${brief.offer}`,
          `Audience: ${brief.audience || "not specified"} · ages ${brief.ageMin}-${brief.ageMax} · ${brief.countries.join(", ")}`,
          `Flight: ${brief.startDate} to ${brief.endDate}`, brief.notes && `Notes: ${brief.notes}`,
          insights ? `COMPETITOR INSIGHTS:\n${JSON.stringify(insights)}` : "No competitor research available.",
          extra?.voice && `WHAT CUSTOMERS SAY (use their words for hooks): ${JSON.stringify({ summary: extra.voice.summary, personas: extra.voice.personas.map((p) => ({ name: p.name, pains: p.pains, desires: p.desires })), phrases: extra.voice.phrases })}`,
          extra?.memory && `WHAT HAS WORKED FOR THIS BRAND BEFORE: ${JSON.stringify(extra.memory)}`, rulebookBlock(rulebook)].filter(Boolean).join("\n"),
        product.slice(0, 4), "high");
      return out.directions;
    },

    generateScene: (direction, brief, product, variant) => timed("scene", async () => {
      const extra = VARIANTS[variant % VARIANTS.length]!;
      // Scenes are made at 4:5 (the main feed shape); square and 9:16 are cut from it with the subject kept central.
      if (product[0]) {
        try {
          return { bytes: await museImage({ prompt: `@Image1${product[1] ? " and @Image2 show" : " shows"} the real ${brief.productName}. ${keepProduct(brief.productName)} ${shotPrompt(direction, `${extra} Keep the product near the centre with breathing room on all sides.`)}`, references: product.slice(0, 2), aspect: "4:5" }), productInScene: true };
        } catch (err) {
          console.warn(`[keel] studio: product-in-scene edit failed, generating an empty scene: ${(err as Error).message}`);
        }
      }
      return { bytes: await museImage({ prompt: shotPrompt(direction, `${extra} Leave clear space in the centre for a product.`), aspect: "4:5" }), productInScene: false };
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

    readSite: (site, images) => call("site", config.models.wonder, READ_SITE, SiteProfileSchema,
      [`URL: ${site.url}`, `Title: ${site.title}`, `Site name: ${site.siteName}`, `Description: ${site.description}`, site.lang && `Language: ${site.lang}`,
        `Colours seen (most used first): ${site.colors.join(", ")}${site.themeColor ? ` · theme ${site.themeColor}` : ""}`, `Fonts: ${site.fonts.join(", ")}`,
        `Navigation: ${site.nav.join(" | ")}`, `Headings: ${site.headings.join(" | ")}`,
        `Products:\n${site.products.map((p, i) => `${i}. ${p.name}${p.price ? ` — ${p.currency ?? ""} ${p.price}` : ""}${p.description ? ` — ${p.description.slice(0, 160)}` : ""}`).join("\n") || "none found"}`,
        `Page text:\n${site.text.slice(0, 3500)}`].filter(Boolean).join("\n"), images.slice(0, 5), "high"),

    learn: (o) => call("learn", config.models.wonder, LEARN, LearnSchema,
      [`Brand: ${o.brand}. Product: ${o.product}.`, "Directions:", ...o.directions.map((d, i) => `${i}. ${d.title} — angle: ${d.angle} — hook: ${d.hook} — headline: "${d.headline}"`),
        `Results (${o.perf.currency}):`, ...o.perf.ads.map((a) => `direction ${a.direction} (${a.title}, ${a.status}): ${a.impressions} impressions, ${a.clicks} link clicks, CTR ${a.ctr.toFixed(2)}%, CPC ${a.cpc.toFixed(2)}, spend ${a.spend.toFixed(2)}, frequency ${a.frequency.toFixed(2)}`),
        o.history.length ? `Earlier reads:\n${o.history.slice(-3).map((h) => `${h.at.slice(0, 10)}: ${h.summary}`).join("\n")}` : "",
        o.insights ? `Competitor insights: ${o.insights.summary}` : ""].filter(Boolean).join("\n"), [], "high"),

    voiceOfCustomer: (o) => call("voice", config.models.wonder, VOICE, VoiceSchema,
      [`Brand: ${o.brand}. Product: ${o.brief.productName}. Market: ${o.brief.countries.join(", ")}.`, "Material:",
        ...o.quotes.slice(0, 80).map((q, i) => `[${i}] (${q.source}) ${q.text.slice(0, 500)}`)].join("\n"), [], "high"),

    async planConcepts(o) {
      const schema = z.object({ concepts: z.array(DirectionSchema.extend({ format: z.enum(FORMATS).catch("classic"), style: z.enum(VISUAL_STYLES).optional().catch(undefined), copy: FormatCopySchema.catch(FormatCopySchema.parse({})), persona: z.string().max(80).catch("") })).min(1).max(24) });
      const ctx = [`Brand: ${o.brand}`, `Product: ${o.brief.productName} (${o.brief.productUrl})`, o.brief.price && `Price: ${o.brief.price}`, o.brief.offer ? `Offer: ${o.brief.offer}` : "No offer.",
        `Audience: ${o.brief.audience || "not stated"} · ${o.brief.countries.join(", ")}`, o.brief.notes && `Notes: ${o.brief.notes}`,
        o.insights && `COMPETITOR INSIGHTS: ${JSON.stringify(o.insights)}`,
        o.voice && `WHAT CUSTOMERS SAY: ${JSON.stringify({ summary: o.voice.summary, personas: o.voice.personas, phrases: o.voice.phrases })}\nREVIEWS OF OUR PRODUCT (the only quotes you may use in a testimonial; if none, don't use that format):\n${o.voice.quotes.slice(0, 20).map((q) => `- "${q.text.slice(0, 220)}" (${q.source})`).join("\n")}`,
        o.memory && `WHAT HAS WORKED FOR THIS BRAND: ${JSON.stringify(o.memory)}`,
        o.remix?.analysis && `COMPETITOR AD (${o.remix.pageName}): ${JSON.stringify(o.remix.analysis)}`, rulebookBlock(o.rulebook)].filter(Boolean).join("\n");
      const out = await call(o.remix ? "remix" : "concepts", config.models.wonder, o.remix ? REMIX : CONCEPTS(o.count, o.formats), schema, ctx,
        [...(o.remix?.image ? [o.remix.image] : []), ...o.product.slice(0, 2)], "high");
      return out.concepts;
    },

    designImage: (o) => timed("design", () => museImage({ prompt: o.prompt, references: o.references, aspect: o.aspect })),
    editDesign: (o) => timed("retouch", () => museImage({
      prompt: `@Image1 is the ad to edit${o.references.length ? `; @Image2 is the real product (keep it exactly)` : ""}. ${o.instruction}${o.expected.length ? `\nThe text must read exactly: ${o.expected.map((t) => `"${t}"`).join(", ")}.` : ""}\nChange nothing else.`,
      references: [o.image, ...o.references], aspect: o.aspect,
    })),
    verifyDesign: (design, product, expected, concept) => call("verify", config.models.spark, VERIFY, DesignCheckSchema,
      `Format: ${concept.format ?? "classic"}.\nExpected text:\n${expected.map((t) => `- "${t}"`).join("\n")}\nImage 1 = REAL PRODUCT, Image 2 = THE AD.`, [product, design], "medium"),

    scoreConcept: (design, product, concept) => call("preflight", config.models.spark, SCORE, ConceptScoreSchema,
      `Format: ${concept.format ?? "classic"}. Headline: "${concept.headline}". Persona: ${concept.persona ?? "general"}.\nImage 1 = REAL PRODUCT, Image 2 = THE AD.`, [product, design], "medium"),

    learnMemory: (o) => call("memory", config.models.wonder, MEMORY, BrandMemorySchema,
      [`Brand: ${o.brand}.`, "Past ads:", ...o.ads.map((a) => JSON.stringify({ name: a.name, impressions: a.impressions, ctr: +a.ctr.toFixed(2), cpc: +a.cpc.toFixed(2), spend: +a.spend.toFixed(2), purchases: a.purchases || undefined, cpa: a.cpa ? +a.cpa.toFixed(2) : undefined, roas: a.roas || undefined, headline: a.title, copy: a.body?.slice(0, 200), creative: a.analysis })),
        o.learnings.length ? `Lessons from Keel campaigns:\n${o.learnings.slice(-15).map((l) => `- ${l}`).join("\n")}` : ""].join("\n"), [], "high"),
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
      return { competitors: brief.competitors.length ? brief.competitors : ["Decathlon", "Wildcraft", "The North Face"], searchTerms: ["rain jacket", "monsoon jacket", "waterproof jacket"], sites: [] };
    },
    /** Scripted stand-in for the agent: searches, reads any competitor sites named in the brief, looks at two ads. */
    async researchLoop(o) {
      // Like the real loop, a failing tool returns an error to the agent instead of stopping it.
      const tool = (n: string) => (args: Record<string, unknown>) => o.tools.find((t) => t.name === n)!.run(args).catch((e: Error) => `error: ${e.message}`);
      await o.onText("Starting with the category search, then the competitors' own sites.");
      const res = JSON.parse(await tool("search_ad_library")({ terms: "rain jacket" })) as { ads?: { id: string }[] };
      const named = o.text.split("\n").find((l) => l.startsWith("Competitors the brand named:")) ?? "";
      for (const u of (named.match(/https?:\/\/[^\s,]+/g) ?? []).slice(0, 2)) { await tool("read_website")({ url: u }); await tool("read_reviews")({ url: u }); }
      await tool("search_reddit")({ query: "rain jacket commute" });
      for (const a of (res.ads ?? []).slice(0, 2)) await tool("look_at_ad")({ id: a.id });
      return "Competitors lead with mountains and discounts; nobody talks about the daily commute.";
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
    async readSite(site) {
      const name = site.siteName || "Northline";
      return {
        brand: { name, oneLiner: `${name} makes weather-ready outerwear for city life.`, voice: "Calm, practical, quietly confident. Short sentences, no hype.", values: ["Built to last", "Honest materials", "City-first"], palette: { base: "#0f2a3d", accent: site.colors.find((c) => c !== "#ffffff" && c !== "#000000") ?? "#e0a23b", ink: "#f4efe6" } },
        category: "Rainwear and outerwear", audience: { summary: "Urban commuters 22-40 who walk or take transit through the monsoon", ageMin: 22, ageMax: 40, countries: ["IN"] },
        heroProduct: 0, heroWhy: "The flagship product, featured first on the homepage, with the clearest photos.", competitors: ["Decathlon", "Wildcraft"], offer: "", goal: "Drive visits to the product page", notes: "Lead with the product; keep copy short.",
      };
    },
    async voiceOfCustomer(o) {
      return { summary: `${o.quotes.length} customer comments read. Commuters complain about arriving soaked and about heavy, sweaty raincoats.`, phrases: ["arrived dry", "not sweaty", "fits in my bag"],
        personas: [{ name: "The monsoon commuter", who: "Takes the train to work through the rains", pains: ["Arrives soaked", "Raincoats are sweaty"], desires: ["Look office-ready"], objections: ["Will it really keep me dry?"], quotes: o.quotes.slice(0, 2).map((q) => q.text) }] };
    },
    async planConcepts(o) {
      const base = presets[0]!;
      const quote = o.voice?.quotes[0]?.text;
      const all: Direction[] = [
        { ...base, title: "Commute notes", format: "notes", persona: "The monsoon commuter", copy: FormatCopySchema.parse({ lines: ["Seam-sealed, not 'water resistant'", "380 g, fits in a laptop bag", "Breathes on humid trains"] }) },
        { ...base, title: "Us vs raincoats", format: "versus", headline: "Not your dad's raincoat", copy: FormatCopySchema.parse({ them: "Typical raincoat", rows: [{ label: "Weight", us: "380 g", them: "Heavy" }, { label: "Seams", us: "Taped", them: "Stitched" }, { label: "Breathes", us: "Yes", them: "Rarely" }] }) },
        { ...base, title: "Arrived dry", format: quote ? "testimonial" : "tweet", copy: FormatCopySchema.parse({ quote: quote ?? "Rain at 9, meeting at 9:30. Still dry.", author: quote ? o.voice!.quotes[0]!.source : "" }) },
        { ...base, title: "Forecast meme", format: "meme", scenePrompt: "A commuter under a bus stop in heavy rain", copy: FormatCopySchema.parse({ top: "Me: no rain today", bottom: "The monsoon:" }) },
        { ...base, title: "POV commute", format: "ugc", copy: FormatCopySchema.parse({ sticker: "POV: you stopped carrying an umbrella" }) },
        { ...base, title: "Soaked vs dry", format: "beforeafter", copy: FormatCopySchema.parse({ before: "Soaked", after: "Dry", scene2: "A soaked commuter on a platform" }) },
      ];
      return (o.remix ? [{ ...all[0]!, title: `Remix of ${o.remix.pageName}`, rationale: "Borrowed the list structure" }] : all).filter((c) => o.formats.includes(c.format as FormatKey) || o.remix).slice(0, o.count);
    },
    /** A stand-in "design": the product photo on a styled backdrop with the quoted words from the brief set as type. */
    async designImage(o) {
      const sizes: Record<string, [number, number]> = { "1:1": [1024, 1024], "4:5": [1024, 1280], "9:16": [1024, 1820], "16:9": [1820, 1024] };
      const [w, h] = sizes[o.aspect] ?? [1024, 1024];
      const textless = /NO TEXT:/.test(o.prompt);
      const words = textless ? [] : [...o.prompt.matchAll(/"([^"]{2,80})"/g)].map((m) => m[1]!).filter((x, i, a) => a.indexOf(x) === i).slice(0, 5);
      const pal = [...o.prompt.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
      const href = o.references[0] && "dataUrl" in o.references[0] ? o.references[0].dataUrl : "";
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><radialGradient id="g" cx=".5" cy=".38" r=".8"><stop offset="0" stop-color="${pal[1] ?? "#e0a23b"}"/><stop offset="1" stop-color="${pal[0] ?? "#0f2a3d"}"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`
        + `<ellipse cx="${w / 2}" cy="${h * 0.66}" rx="${w * 0.3}" ry="${w * 0.05}" fill="#000" opacity=".25"/>`
        + (href ? `<image href="${href}" x="${w * 0.2}" y="${h * 0.2}" width="${w * 0.6}" height="${h * 0.48}" preserveAspectRatio="xMidYMid meet"/>` : "")
        + words.map((t, i) => `<text x="${w / 2}" y="${h * 0.12 + i * 70}" text-anchor="middle" font-family="Helvetica" font-weight="${i ? 500 : 800}" font-size="${i ? 34 : 60}" fill="#fff">${esc(t)}</text>`).join("")
        + `</svg>`;
      return renderSvgToPng(svg, w, h);
    },
    async editDesign(o) {
      return Buffer.from(("dataUrl" in o.image ? o.image.dataUrl : "").split(",")[1] ?? "", "base64");
    },
    async verifyDesign(_d, _p, expected) {
      const fail = process.env.FAKE_DESIGN_TEXT_FAIL === "1";
      return { texts: expected.map((e) => ({ expected: e, found: fail ? e.slice(0, -1) : e, exact: !fail })), extraText: [], product: 0.9, quality: 0.8, artifacts: [], fix: fail ? "Fix the headline spelling" : "" };
    },
    async scoreConcept(_d, _p, c) {
      const n = (c.title.length * 7) % 30;
      return { overall: 0.55 + n / 100, scrollStop: 0.6, clarity: 0.7, product: 0.85, text: 0.75, brand: 0.8, notes: "Make the headline bigger." };
    },
    async learnMemory(o) {
      return { summary: `${o.ads.length} past ads read.`, winners: ["Close-up product shots with one clear benefit"], losers: ["Busy lifestyle scenes with long copy"], doMore: ["Lead with the commute"], avoid: ["Discount-first headlines"] };
    },
    async learn(o) {
      const ranked = [...o.perf.ads].filter((a) => a.impressions > 0).sort((a, b) => b.ctr - a.ctr);
      const best = ranked[0];
      const enough = ranked.length > 1 && ranked.every((a) => a.impressions >= 1000);
      const lead = best && enough && best.ctr >= (ranked[1]?.ctr ?? 0) * 1.3;
      const dir = best ? o.directions[best.direction] : undefined;
      return {
        summary: !ranked.length ? "No delivery yet, so nothing to learn." : lead ? `"${best!.title}" is clearly ahead: ${best!.ctr.toFixed(2)}% CTR against ${ranked[1]!.ctr.toFixed(2)}%. Its hook speaks to a moment people recognise.` : "Too early to call: the directions are close or still gathering impressions.",
        winner: lead ? best!.direction : null, confidence: lead ? "high" : "low",
        learnings: lead ? [`${best!.title}'s everyday-moment hook beats aspirational scenes`, "Short headlines with one concrete benefit get more clicks", ...(ranked.some((a) => a.frequency > 3) ? ["Frequency is climbing; a fresh variant will keep costs down"] : [])] : ["Waiting for at least 1,000 impressions per ad"],
        nextIdea: lead && dir ? { basedOn: best!.direction, title: `${dir.title} · night`, angle: dir.angle, hook: "Late train, still dry.", headline: "Late train. Still dry.", subline: dir.subline, primaryText: dir.primaryText, scenePrompt: `${dir.scenePrompt}, at night under sodium street lights`, why: "Same winning commute angle, new moment: the ride home." } : null,
      };
    },
  };
}
