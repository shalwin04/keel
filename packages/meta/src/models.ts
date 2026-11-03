import OpenAI from "openai";
import type { z } from "zod";
import { config } from "./config.ts";

let _meta: OpenAI | undefined;
let _open: OpenAI | undefined;

/** Meta Model API — OpenAI-compatible. */
export const metaClient = () =>
  (_meta ??= new OpenAI({ baseURL: config.metaApiBase, apiKey: config.metaApiKey }));

/** Open-weight tier (Muse Spark Open / Glimmer on Baseten or Modal) — OpenAI-compatible. */
export const openWeightClient = () =>
  (_open ??= new OpenAI({ baseURL: config.openWeight.baseURL, apiKey: config.openWeight.apiKey }));

export type ImageInput = { url: string } | { dataUrl: string };
const imagePart = (img: ImageInput) => ({
  type: "image_url" as const,
  image_url: { url: "url" in img ? img.url : img.dataUrl },
});

export interface JsonCallOpts<T> {
  client: OpenAI;
  model: string;
  system: string;
  text: string;
  images?: ImageInput[];
  schema: z.ZodType<T>;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Called after every model request, for the live trace and cost accounting. */
  onCall?: (info: ModelCallInfo) => void;
}

export interface ModelCallInfo {
  model: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** USD per million tokens [input, output]. Override per deployment; unknown models report no cost. */
export const PRICES: Record<string, [number, number]> = {
  "muse-spark-1.1": [1.25, 4.25],
  "muse-wonder-1.0": [4, 20],
};

export function costOf(model: string, inTok = 0, outTok = 0): number | undefined {
  const p = PRICES[model];
  return p ? (inTok * p[0] + outTok * p[1]) / 1e6 : undefined;
}

/** One multimodal call that must return JSON matching `schema`. Retries once on a parse failure. */
export async function callJson<T>(o: JsonCallOpts<T>): Promise<T> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: `${o.system}\nRespond with a single JSON object only.` },
    { role: "user", content: [{ type: "text", text: o.text }, ...(o.images ?? []).map(imagePart)] },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    const res = await o.client.chat.completions.create({
      model: o.model,
      messages,
      response_format: { type: "json_object" },
      // Meta extension; ignored by providers that don't support it.
      ...(o.reasoningEffort ? ({ reasoning_effort: o.reasoningEffort } as object) : {}),
    });
    const inTok = res.usage?.prompt_tokens;
    const outTok = res.usage?.completion_tokens;
    o.onCall?.({ model: o.model, ms: Date.now() - t0, inputTokens: inTok, outputTokens: outTok, costUsd: costOf(o.model, inTok, outTok) });
    const raw = res.choices[0]?.message?.content ?? "";
    const parsed = o.schema.safeParse(safeJson(raw));
    if (parsed.success) return parsed.data;
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: `That did not match the schema: ${parsed.error.message}. Return corrected JSON only.` },
    );
  }
  throw new Error(`Model ${o.model} did not return valid JSON`);
}

// ── Muse Image: aspect ratios and multiple references ───────────────────────

export type Aspect = "1:1" | "4:5" | "9:16" | "16:9";
/** Pixel sizes sent for each aspect ratio. MUSE_IMAGE_SIZES (JSON) overrides them once the probe shows what the API accepts. */
const SIZE_FOR: Record<Aspect, string> = { "1:1": "1024x1024", "4:5": "1024x1280", "9:16": "1024x1792", "16:9": "1792x1024", ...JSON.parse(process.env.MUSE_IMAGE_SIZES ?? "{}") };
const ASPECT_WORDS: Record<Aspect, string> = { "1:1": "square 1:1", "4:5": "vertical 4:5 portrait", "9:16": "tall vertical 9:16 full-screen (Stories/Reels)", "16:9": "wide 16:9" };
const unsupportedSizes = new Set<string>();

/**
 * Muse Image with up to 10 references (product, logo, style, character…), at a target aspect ratio.
 * References go to the Responses API as input images, named in the prompt as @Image1, @Image2… The aspect ratio is stated in the prompt and,
 * where the API accepts it, as a size. Text-only prompts use /images/generations at the matching size.
 */
export async function museImage(o: { prompt: string; references?: ImageInput[]; aspect?: Aspect; onCall?: (i: ModelCallInfo) => void }): Promise<Buffer> {
  const aspect = o.aspect ?? "1:1";
  const prompt = `${o.prompt}\nFormat: ${ASPECT_WORDS[aspect]} composition, framed for that shape.`;
  const refs = (o.references ?? []).slice(0, 10);
  if (!refs.length) {
    const size = unsupportedSizes.has(SIZE_FOR[aspect]) ? "1024x1024" : SIZE_FOR[aspect];
    try {
      return await generateImage({ prompt, size, onCall: o.onCall });
    } catch (err) {
      if (size === "1024x1024" || !/size|dimension|resolution|invalid/i.test((err as Error).message)) throw err;
      unsupportedSizes.add(size);
      return generateImage({ prompt, size: "1024x1024", onCall: o.onCall });
    }
  }
  // The Responses API takes no size: the shape comes from the prompt (stated first and last), and is checked on the result.
  const want = { "1:1": 1, "4:5": 0.8, "9:16": 0.5625, "16:9": 16 / 9 }[aspect];
  const call = async (strong: boolean) => {
    const t0 = Date.now();
    // Edits tend to keep the input's shape; on a retry, an empty canvas of the right shape is added as the last reference.
    const canvas = strong && refs.length < 10 ? `data:image/png;base64,${(await canvasOf(aspect)).toString("base64")}` : undefined;
    const lead = `OUTPUT SHAPE: ${ASPECT_WORDS[aspect]}${aspect === "1:1" ? "" : aspect === "16:9" ? " (wider than tall)" : " (taller than wide)"}.${strong ? ` This is essential: do not return a landscape or square image.${canvas ? ` @Image${refs.length + 1} is an empty canvas with exactly the output shape: fill it completely with the result (ignore its grey colour).` : ""}` : ""}`;
    const res = await fetch(`${config.metaApiBase}/responses`, {
      method: "POST", headers: { Authorization: `Bearer ${config.metaApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.models.image, input: [{ role: "user", content: [...refs.map((r) => ({ type: "input_image", image_url: "url" in r ? r.url : r.dataUrl })), ...(canvas ? [{ type: "input_image", image_url: canvas }] : []), { type: "input_text", text: `${lead}\n${prompt}` }] }] }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`Muse Image ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { output?: { type: string; result?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
    o.onCall?.({ model: config.models.image, ms: Date.now() - t0, inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens });
    const img = json.output?.find((x) => x.type === "image_generation_call" && x.result)?.result;
    if (!img) throw new Error(`Muse Image returned no image${json.error?.message ? `: ${json.error.message}` : ""}`);
    return Buffer.from(img, "base64");
  };
  const first = await call(false);
  const size = imageSize(first);
  if (!size || Math.abs(size.w / size.h - want) / want < 0.15) return first;
  return call(true).then((second) => { const s2 = imageSize(second); return s2 && Math.abs(s2.w / s2.h - want) < Math.abs(size.w / size.h - want) ? second : first; }).catch(() => first);
}

const canvasCache = new Map<Aspect, Promise<Buffer>>();
function canvasOf(aspect: Aspect) {
  const [w, h] = ({ "1:1": [512, 512], "4:5": [512, 640], "9:16": [504, 896], "16:9": [896, 504] } as const)[aspect];
  if (!canvasCache.has(aspect)) canvasCache.set(aspect, import("./render.ts").then((r) => r.renderSvgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#bdbdbd"/></svg>`, w, h)));
  return canvasCache.get(aspect)!;
}

/** Width and height of PNG, WebP or JPEG bytes (no decoding). */
export function imageSize(b: Buffer): { w: number; h: number } | undefined {
  try {
    if (b.subarray(0, 4).toString("hex") === "89504e47") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.subarray(0, 4).toString("ascii") === "RIFF") {
      const kind = b.subarray(12, 16).toString("ascii");
      if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L") { const n = b.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }; }
    }
    if (b.subarray(0, 3).toString("hex") === "ffd8ff") {
      for (let i = 2; i < b.length - 9;) {
        if (b[i] !== 0xff) return undefined;
        const m = b[i + 1]!;
        if (m >= 0xc0 && m <= 0xc3) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch { /* unknown */ }
  return undefined;
}

/** A tool the model can call during an agent loop. `run` returns what the model sees (plain text or JSON). */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<string>;
}

/**
 * A tool-calling loop (OpenAI-compatible function calling): the model reasons, calls tools (several at once if it wants),
 * reads the results and continues until it answers in plain text or runs out of steps. Returns its final text.
 */
export async function runTools(o: {
  client: OpenAI; model: string; system: string; text: string; images?: ImageInput[]; tools: AgentTool[]; maxSteps: number; maxParallel?: number;
  reasoningEffort?: JsonCallOpts<unknown>["reasoningEffort"]; onCall?: (i: ModelCallInfo) => void; onText?: (text: string) => void | Promise<void>;
}): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: o.system },
    { role: "user", content: [{ type: "text", text: o.text }, ...(o.images ?? []).map(imagePart)] },
  ];
  const defs = o.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const ask = async (withTools: boolean) => {
    const t0 = Date.now();
    const res = await o.client.chat.completions.create({
      model: o.model, messages, ...(withTools ? { tools: defs } : {}),
      ...(o.reasoningEffort ? ({ reasoning_effort: o.reasoningEffort } as object) : {}),
    });
    const inTok = res.usage?.prompt_tokens, outTok = res.usage?.completion_tokens;
    o.onCall?.({ model: o.model, ms: Date.now() - t0, inputTokens: inTok, outputTokens: outTok, costUsd: costOf(o.model, inTok, outTok) });
    return res.choices[0]?.message;
  };
  for (let step = 0; step < o.maxSteps; step++) {
    const msg = await ask(true);
    if (!msg) break;
    if (msg.content?.trim()) await o.onText?.(msg.content.trim());
    const calls = (msg.tool_calls ?? []).filter((c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === "function");
    if (!calls.length) return msg.content ?? "";
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    const results: string[] = new Array(calls.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(o.maxParallel ?? 3, calls.length) }, async () => {
      while (next < calls.length) {
        const i = next++;
        const c = calls[i]!;
        const tool = o.tools.find((t) => t.name === c.function.name);
        const args = (safeJson(c.function.arguments || "{}") ?? {}) as Record<string, unknown>;
        try { results[i] = tool ? await tool.run(args) : `error: there is no tool called ${c.function.name}`; }
        catch (err) { results[i] = `error: ${(err as Error).message.slice(0, 300)}`; }
      }
    }));
    for (const [i, c] of calls.entries()) messages.push({ role: "tool", tool_call_id: c.id, content: results[i]!.slice(0, 8000) });
  }
  messages.push({ role: "user", content: "That's the research budget used up. In a few sentences, say what you found." });
  return (await ask(false))?.content ?? "";
}

/**
 * Web search through Muse Wonder's search grounding (Responses API with the web search tool). Returns the model's answer and the
 * pages it cited. The tool type can be overridden with META_SEARCH_TOOL if Meta names it differently.
 */
export async function groundedSearch(query: string, o: { onCall?: (i: ModelCallInfo) => void } = {}): Promise<{ answer: string; sources: { url: string; title: string }[] }> {
  const t0 = Date.now();
  const res = await fetch(`${config.metaApiBase}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.metaApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.models.wonder, tools: [{ type: process.env.META_SEARCH_TOOL ?? "web_search" }], input: `Search the web and answer briefly, citing pages: ${query}` }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`search grounding ${res.status}: ${(await res.text()).slice(0, 200)}`);
  type Ann = { type?: string; url?: string; title?: string };
  const j = (await res.json()) as { output_text?: string; output?: { type: string; content?: { type: string; text?: string; annotations?: Ann[] }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  o.onCall?.({ model: config.models.wonder, ms: Date.now() - t0, inputTokens: j.usage?.input_tokens, outputTokens: j.usage?.output_tokens });
  const parts = (j.output ?? []).flatMap((x) => x.content ?? []).filter((c) => c.type === "output_text" || c.text);
  const answer = j.output_text ?? parts.map((c) => c.text ?? "").join("\n");
  const seen = new Set<string>();
  const sources = parts.flatMap((c) => c.annotations ?? []).filter((a) => a.url && !seen.has(a.url) && seen.add(a.url)).map((a) => ({ url: a.url!, title: a.title ?? a.url! }));
  return { answer: answer.slice(0, 4000), sources: sources.slice(0, 10) };
}

function safeJson(s: string): unknown {
  const m = s.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : s); } catch { return undefined; }
}

/** Muse Image, text to image (`/images/generations`). Returns image bytes (Meta sends WebP). */
export async function generateImage(o: { prompt: string; references?: ImageInput[]; size?: string; onCall?: (i: ModelCallInfo) => void }): Promise<Buffer> {
  // Reference images go through the edit path: the generations endpoint doesn't take them.
  if (o.references?.length) return editImage({ prompt: o.prompt, image: o.references[0]!, onCall: o.onCall });
  const t0 = Date.now();
  const res = await fetch(`${config.metaApiBase}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.metaApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.models.image, prompt: o.prompt, size: o.size ?? "1024x1024", n: 1, response_format: "b64_json" }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Muse Image ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  o.onCall?.({ model: config.models.image, ms: Date.now() - t0, inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens });
  const first = json.data?.[0];
  if (first?.b64_json) return Buffer.from(first.b64_json, "base64");
  if (first?.url) return Buffer.from(await (await fetch(first.url)).arrayBuffer());
  throw new Error("Muse Image returned no image");
}

/**
 * Muse Image, image to image (Responses API): keeps what the instruction says to keep (e.g. the product)
 * and changes the rest. The image comes back as an `image_generation_call` output item.
 */
export async function editImage(o: { prompt: string; image: ImageInput; onCall?: (i: ModelCallInfo) => void }): Promise<Buffer> {
  const t0 = Date.now();
  const res = await fetch(`${config.metaApiBase}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.metaApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.models.image,
      input: [{ role: "user", content: [{ type: "input_image", image_url: "url" in o.image ? o.image.url : o.image.dataUrl }, { type: "input_text", text: o.prompt }] }],
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`Muse Image ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { output?: { type: string; result?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
  o.onCall?.({ model: config.models.image, ms: Date.now() - t0, inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens });
  const img = json.output?.find((x) => x.type === "image_generation_call" && x.result)?.result;
  if (!img) throw new Error(`Muse Image returned no image${json.error?.message ? `: ${json.error.message}` : ""}`);
  return Buffer.from(img, "base64");
}
