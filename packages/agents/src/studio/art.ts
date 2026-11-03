import {
  CTA_TYPES, FormatCopySchema, PHOTO_STYLES, STYLE_BLOCK, VISUAL_STYLES,
  type Brief, type DesignCheck, type DesignInfo, type Direction, type FormatKey, type VisualStyle,
} from "@keel/core";
import { inlineImageHref, saveMedia, type Aspect, type ImageInput } from "@keel/meta";
import type { StudioModels } from "./models.ts";

const CTA: Record<(typeof CTA_TYPES)[number], string> = { SHOP_NOW: "Shop now", LEARN_MORE: "Learn more", SIGN_UP: "Sign up", GET_OFFER: "Get offer", ORDER_NOW: "Order now", SEE_MORE: "See more" };
const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

/** The default visual language for a format when the art director hasn't picked one. */
export function defaultStyle(format: FormatKey): VisualStyle {
  return ({ classic: "photoreal", notes: "lifestyle", tweet: "lifestyle", testimonial: "lifestyle", versus: "render3d", beforeafter: "cinematic", offer: "render3d", meme: "lifestyle", ugc: "lifestyle" } as const)[format];
}

/** The exact words a design must carry (what Muse Spark checks letter by letter). */
export function expectedText(c: Direction, brief: Brief): string[] {
  const copy = FormatCopySchema.parse(c.copy ?? {});
  const f = c.format ?? "classic";
  const words = [c.headline];
  if (f === "notes") words.push(...copy.lines.slice(0, 4));
  if (f === "tweet" || f === "testimonial") words.splice(0, 1, copy.quote || c.headline);
  if (f === "versus") words.push(...copy.rows.slice(0, 3).flatMap((r) => [r.us, r.them]).filter(Boolean));
  if (f === "beforeafter") words.push(copy.before || "Before", copy.after || "After");
  if (f === "offer" && brief.offer) words.push(brief.offer);
  if (f === "meme") words.splice(0, 1, copy.top || c.headline, copy.bottom || c.subline);
  if (f === "ugc") words.splice(0, 1, copy.sticker || c.hook);
  return words.filter((w) => w && w.trim().length > 0).slice(0, 8);
}

/**
 * The art brief for Muse Image, written the way a top creative would brief a photographer or 3D artist: story moment, subject (the real product
 * from the references), style block, light and camera, composition with safe zones, the exact text in quotes, brand colours, and what to avoid.
 */
export function artBrief(o: { c: Direction; brief: Brief; brand: string; style: VisualStyle; aspect: Aspect; withText: boolean; productRefs: number; logoRef: boolean }) {
  const { c, brief, style } = o;
  const copy = FormatCopySchema.parse(c.copy ?? {});
  const f = c.format ?? "classic";
  const imgs = Array.from({ length: o.productRefs }, (_, i) => `@Image${i + 1}`).join(" and ");
  const logo = o.logoRef ? `@Image${o.productRefs + 1}` : "";
  const photo = PHOTO_STYLES.includes(style);
  const moment = c.visual || c.scenePrompt || c.angle;
  const product = photo
    ? `${imgs} ${o.productRefs > 1 ? "are photos" : "is a photo"} of the real ${brief.productName}. Show exactly this product: same shape, colours, materials, stitching, logo and proportions. Never redraw, restyle or invent product details; relight it to match the scene with correct contact shadows and reflections.`
    : `${imgs} ${o.productRefs > 1 ? "show" : "shows"} the real ${brief.productName}. Render it in this style but keep it unmistakably the same product: same silhouette, colours, key details and logo placement.`;
  const scene: Record<FormatKey, string> = {
    classic: `A hero image of this moment: ${moment}. The product is the clear hero, about a third of the frame.`,
    notes: `A realistic close-up of a hand holding a modern smartphone, set in this moment: ${moment}. The phone screen shows an Apple Notes-style page titled ${q(c.headline)} with these lines as a list: ${copy.lines.slice(0, 4).map(q).join(", ")}. The product is visible in the scene (worn, held or beside the phone).`,
    tweet: `A smartphone on a surface in this moment: ${moment}. Its screen shows a social post from ${o.brand} that reads exactly ${q(copy.quote || c.headline)}, with no like, comment or follower counts. The product is in the scene.`,
    testimonial: `A tasteful printed quote card or handwritten note lying in this moment: ${moment}, reading exactly ${q(copy.quote)} with the attribution ${q(`— ${copy.author || "a customer"}`)}. The product sits beside it.`,
    versus: `A clean split comparison. One side: the product in a bright, premium setting labelled ${q(o.brand)}. Other side: a dull, generic alternative labelled ${q(copy.them || "Others")} (no real brand, no logo). Between them a short comparison: ${copy.rows.slice(0, 3).map((r) => `${q(r.label)}: ${q(r.us)} vs ${q(r.them)}`).join("; ")}.`,
    beforeafter: `A split before/after frame telling one story. Before: ${copy.scene2 || "the problem moment"}, labelled ${q(copy.before || "Before")}. After: ${moment} with the product solving it, labelled ${q(copy.after || "After")}. Same person or setting on both sides.`,
    offer: `A bold offer poster: ${moment}. The offer ${q(brief.offer)} is huge and unmissable; the product is the hero.`,
    meme: `A relatable meme photo of this situation: ${moment}. Classic white meme caption with a black outline: top ${q(copy.top || c.headline)}, bottom ${q(copy.bottom || c.subline)}.`,
    ugc: `An authentic creator-style photo, shot on a phone, natural light: ${moment}, the creator using or wearing the product. An on-screen caption sticker (white box, black text) reads ${q(copy.sticker || c.hook)}.`,
  };
  const text = o.withText
    ? `TEXT: render every word exactly as written, correctly spelled, and no other words anywhere. ${f === "classic" || f === "offer" || f === "beforeafter" ? `Headline ${q(c.headline)} in a bold modern sans-serif, large and high-contrast; ` : ""}a small rounded call-to-action button ${q(CTA[c.cta])}.${logo ? ` Place the logo from ${logo} small in a corner exactly as given; do not redraw it.` : ` No logos other than the product's own.`}`
    : `NO TEXT: no words, letters, numbers, logos or UI anywhere in the image. Leave clean, calm space ${o.aspect === "9:16" ? "in the upper third and lower third" : "in the lower third"} for type added later.`;
  return [
    `Create a finished, scroll-stopping ${o.withText ? "Instagram and Facebook ad" : "key visual for an Instagram and Facebook ad"} for ${o.brand}.`,
    `STORY: ${c.hook}. ${c.angle}`,
    `SCENE: ${o.withText ? scene[f] : `A hero image of this moment: ${moment}. The product is the clear hero.`}`,
    `SUBJECT: ${product}`,
    `STYLE: ${STYLE_BLOCK[style]}`,
    c.art.lighting && `LIGHT: ${c.art.lighting}.`, c.art.camera && photo && `CAMERA: ${c.art.camera}.`, c.art.grade && `GRADE: ${c.art.grade}.`, c.art.props && `PROPS: ${c.art.props}.`,
    `COMPOSITION: one clear focal point, strong figure-ground contrast, readable at phone size.${o.aspect === "9:16" ? " Keep text and key details out of the top 14% and bottom 25% (Stories and Reels interface)." : ""}`,
    text,
    `COLOURS: brand palette ${c.palette.base}, ${c.palette.accent}, ${c.palette.ink}.`,
    `AVOID: garbled, extra or misspelled text, distorted or redrawn product, extra logos, watermarks, fake engagement numbers, plastic skin, extra fingers, warped hands, cluttered backgrounds${c.art.avoid ? `, ${c.art.avoid}` : ""}.`,
  ].filter(Boolean).join("\n");
}

export interface DesignResult { ref: string; mode: DesignInfo["mode"]; info: DesignInfo }

/**
 * Muse Image designs the finished ad (text included) from the story, the real product and the logo; Muse Spark checks every word and the product
 * like a retoucher; one targeted edit fixes what it flags. If the text still isn't exact, Keel falls back to a text-free key visual (mode "art")
 * that the layout engine puts live type on, so a typo never ships.
 */
export async function designAd(o: {
  models: StudioModels; c: Direction; brief: Brief; brand: string; aspect: Aspect; logoRef?: string; style?: VisualStyle; takes?: number;
  log?: (t: string, kind?: "info" | "decision" | "warn") => Promise<void>;
}): Promise<DesignResult> {
  const { models, c, brief } = o;
  const style = o.style ?? (c.style && VISUAL_STYLES.includes(c.style) ? c.style : defaultStyle(c.format ?? "classic"));
  const productRefs: ImageInput[] = await Promise.all(brief.productPhotos.slice(0, 2).map(async (r) => ({ dataUrl: await inlineImageHref(r) })));
  const refs = [...productRefs, ...(o.logoRef ? [{ dataUrl: await inlineImageHref(o.logoRef) }] : [])];
  const expected = expectedText(c, brief);
  const prompt = artBrief({ c, brief, brand: o.brand, style, aspect: o.aspect, withText: true, productRefs: productRefs.length, logoRef: !!o.logoRef });
  const takes = Math.max(1, Math.min(3, o.takes ?? Number(process.env.STUDIO_DESIGN_TAKES ?? 2)));
  let attempts = 0;

  const check = async (bytes: Buffer) => {
    const ref = await saveMedia(bytes, ".png", "designs");
    const raw = await models.verifyDesign({ dataUrl: await inlineImageHref(ref) }, productRefs[0]!, expected, c).catch(() => undefined);
    const pass = !!raw && raw.texts.length > 0 && raw.texts.every((t) => t.exact) && raw.extraText.length <= 1 && raw.product >= 0.7 && raw.artifacts.length === 0;
    return { ref, check: raw ? { ...raw, pass } : undefined };
  };
  const rank = (x: { check?: DesignCheck }) => (x.check ? (x.check.pass ? 2 : 0) + x.check.texts.filter((t) => t.exact).length / Math.max(1, x.check.texts.length) + x.check.product * 0.5 + x.check.quality * 0.5 : -1);

  const shots = (await Promise.all(Array.from({ length: takes }, async () => {
    attempts++;
    try { return await check(await models.designImage({ prompt, references: refs, aspect: o.aspect })); } catch (err) { await o.log?.(`${c.title}: a take failed (${(err as Error).message.slice(0, 80)})`, "warn"); return undefined; }
  }))).filter((x): x is NonNullable<typeof x> => !!x);
  let best = shots.sort((a, b) => rank(b) - rank(a))[0];

  if (best && !best.check?.pass && best.check?.fix) {
    attempts++;
    try {
      const fixed = await check(await models.editDesign({ image: { dataUrl: await inlineImageHref(best.ref) }, instruction: best.check.fix, references: productRefs, aspect: o.aspect, expected }));
      if (rank(fixed) > rank(best)) best = fixed;
      await o.log?.(`${c.title}: retouched — ${best.check?.fix ?? ""}`.slice(0, 200), "decision");
    } catch { /* keep the best take */ }
  }
  if (best?.check?.pass) {
    await o.log?.(`${c.title}: Muse Image design passed the text and product check (${style})`, "decision");
    return { ref: best.ref, mode: "generated", info: { mode: "generated", style, check: best.check, attempts, prompt } };
  }

  // Fallback: a text-free key visual; the layout engine sets the type.
  attempts++;
  const artPrompt = artBrief({ c, brief, brand: o.brand, style, aspect: o.aspect, withText: false, productRefs: productRefs.length, logoRef: false });
  const art = await saveMedia(await models.designImage({ prompt: artPrompt, references: productRefs, aspect: o.aspect }), ".png", "designs");
  const why = best?.check ? best.check.texts.filter((t) => !t.exact).map((t) => `"${t.expected}" came out "${t.found}"`)[0] ?? best.check.artifacts[0] ?? "check failed" : "no usable take";
  await o.log?.(`${c.title}: text wasn't exact (${why}), so Keel set the type itself over Muse Image's artwork`, "warn");
  return { ref: art, mode: "art", info: { mode: "art", style, check: best?.check, attempts, prompt: artPrompt } };
}

/** Re-lays a generated design for another aspect ratio by editing it (not cropping), then checks the words again. */
export async function resizeDesign(o: { models: StudioModels; c: Direction; brief: Brief; fromRef: string; aspect: Aspect }): Promise<{ ref: string; ok: boolean }> {
  const expected = expectedText(o.c, o.brief);
  const product = { dataUrl: await inlineImageHref(o.brief.productPhotos[0]!) };
  const bytes = await o.models.editDesign({
    image: { dataUrl: await inlineImageHref(o.fromRef) }, references: [product], aspect: o.aspect, expected,
    instruction: `Recompose this exact ad for a ${o.aspect} frame. Keep every word identical and correctly spelled, the same product, logo, style, colours and story. Extend the scene naturally instead of stretching or cropping anything important.${o.aspect === "9:16" ? " Keep text out of the top 14% and bottom 25%." : ""}`,
  });
  const ref = await saveMedia(bytes, ".png", "designs");
  const chk = await o.models.verifyDesign({ dataUrl: await inlineImageHref(ref) }, product, expected, o.c).catch(() => undefined);
  return { ref, ok: !!chk && chk.texts.every((t) => t.exact) && chk.product >= 0.7 };
}

/** "Warmer light", "move the product left": one precise Muse Image edit on a finished design, then the same check. */
export async function refineDesign(o: { models: StudioModels; c: Direction; brief: Brief; fromRef: string; aspect: Aspect; instruction: string; generated: boolean }) {
  const expected = o.generated ? expectedText(o.c, o.brief) : [];
  const product = { dataUrl: await inlineImageHref(o.brief.productPhotos[0]!) };
  const bytes = await o.models.editDesign({
    image: { dataUrl: await inlineImageHref(o.fromRef) }, references: [product], aspect: o.aspect, expected,
    instruction: `${o.instruction}. Change only that. Keep the ${o.brief.productName} exactly as it is${o.generated ? ", and every word of text identical" : ", and add no text"}.`,
  });
  const ref = await saveMedia(bytes, ".png", "designs");
  const chk = expected.length ? await o.models.verifyDesign({ dataUrl: await inlineImageHref(ref) }, product, expected, o.c).catch(() => undefined) : undefined;
  return { ref, ok: !expected.length || (!!chk && chk.texts.every((t) => t.exact)), check: chk };
}
