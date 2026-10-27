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

function safeJson(s: string): unknown {
  const m = s.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : s); } catch { return undefined; }
}
