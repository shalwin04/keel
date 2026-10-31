import type { Region } from "@keel/core";
import { config } from "./config.ts";
import type { ImageInput } from "./models.ts";

/** Region isolation. SAM 3.1 behind an interface so the API shape can change without touching the agent. */
export interface Segmenter {
  readonly name: string;
  segment(image: ImageInput, concepts: string[]): Promise<Region[]>;
}

/**
 * SAM 3.1 through the Meta Model API Responses endpoint. The response format is parsed tolerantly
 * (see parseSamOutput); if the call fails, Keel falls back to whole-image regions instead of failing the cycle.
 */
export class MetaSamSegmenter implements Segmenter {
  readonly name = "sam-3.1";
  constructor(private fallback: Segmenter = new WholeImageSegmenter()) {}
  async segment(image: ImageInput, concepts: string[]): Promise<Region[]> {
    try {
      const res = await fetch(`${config.metaApiBase}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.metaApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.models.sam,
          input: [{
            role: "user",
            content: [
              { type: "input_image", image_url: "url" in image ? image.url : image.dataUrl },
              { type: "input_text", text: concepts.join(", ") },
            ],
          }],
        }),
      });
      if (!res.ok) throw new Error(`SAM ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      if (process.env.SAM_DEBUG === "1") console.log("[keel] SAM raw:", JSON.stringify(json).slice(0, 4000));
      const regions = parseSamOutput(json, concepts);
      return regions.length ? regions : this.fallback.segment(image, concepts);
    } catch (err) {
      console.warn(`[keel] SAM failed, using whole-image regions: ${(err as Error).message}`);
      return this.fallback.segment(image, concepts);
    }
  }
}

type Box = [number, number, number, number];
const BOX_KEYS = ["box", "bbox", "bounding_box", "boundingBox", "xyxy", "box_2d", "xywh"];
const LABEL_KEYS = ["label", "concept", "class", "category", "name", "text", "prompt"];
const SCORE_KEYS = ["score", "confidence", "probability"];

function asBox(v: unknown, key: string): Box | undefined {
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number")) {
    const [a, b, c, d] = v as Box;
    // xywh when named so, or when the 3rd/4th values can't be bottom-right corners.
    if (key === "xywh" || (key !== "xyxy" && (c < a || d < b))) return [a, b, a + c, b + d];
    return [a, b, c, d];
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, number>;
    const x = o.x ?? o.x1 ?? o.left ?? o.xmin, y = o.y ?? o.y1 ?? o.top ?? o.ymin;
    if (typeof x !== "number" || typeof y !== "number") return undefined;
    const x2 = o.x2 ?? o.right ?? o.xmax ?? (typeof o.width === "number" ? x + o.width : typeof o.w === "number" ? x + o.w : undefined);
    const y2 = o.y2 ?? o.bottom ?? o.ymax ?? (typeof o.height === "number" ? y + o.height : typeof o.h === "number" ? y + o.h : undefined);
    if (typeof x2 !== "number" || typeof y2 !== "number") return undefined;
    return [x, y, x2, y2];
  }
  return undefined;
}

/**
 * Finds detections anywhere in a SAM response: any object carrying a 4-number box plus a label.
 * Pixel boxes are normalised with the image size if the response states it, else by the largest coordinate.
 * Labels that aren't one of the requested concepts are matched to the closest concept by substring.
 */
export function parseSamOutput(json: unknown, concepts: string[]): Region[] {
  const found: { label: string; box: Box; score?: number; maskRef?: string }[] = [];
  let width: number | undefined, height: number | undefined;

  const walk = (node: unknown, inherited?: string) => {
    if (typeof node === "string") {
      // Some APIs return JSON as a text part.
      const t = node.trim();
      if ((t.startsWith("{") || t.startsWith("[")) && t.length < 2_000_000) { try { walk(JSON.parse(t), inherited); } catch { /* not JSON */ } }
      return;
    }
    if (Array.isArray(node)) { node.forEach((n) => walk(n, inherited)); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.width === "number" && typeof o.height === "number" && o.width > 1 && !("x" in o)) { width = o.width; height = o.height; }
    if (typeof o.image_width === "number") width = o.image_width;
    if (typeof o.image_height === "number") height = o.image_height;
    const label = LABEL_KEYS.map((k) => o[k]).find((v): v is string => typeof v === "string") ?? inherited;
    for (const k of BOX_KEYS) {
      const box = asBox(o[k], k);
      if (box && label) {
        const score = SCORE_KEYS.map((s) => o[s]).find((v): v is number => typeof v === "number");
        const mask = typeof o.mask === "string" && o.mask.length < 512 ? o.mask : typeof o.mask_url === "string" ? o.mask_url : undefined;
        found.push({ label, box, score, maskRef: mask });
        break;
      }
    }
    for (const [k, v] of Object.entries(o)) {
      if (BOX_KEYS.includes(k)) continue;
      // Results keyed by concept: { "person": [ {box...} ] }
      const keyLabel = concepts.includes(k) ? k : label;
      walk(v, keyLabel);
    }
  };
  walk(json);

  const maxX = Math.max(1, ...found.map((f) => Math.max(f.box[0], f.box[2])));
  const maxY = Math.max(1, ...found.map((f) => Math.max(f.box[1], f.box[3])));
  const sx = maxX > 1 ? (width ?? maxX) : 1;
  const sy = maxY > 1 ? (height ?? maxY) : 1;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const match = (l: string) => concepts.find((c) => c === l) ?? concepts.find((c) => l.toLowerCase().includes(c) || c.includes(l.toLowerCase())) ?? l;

  return found
    .filter((f) => f.score === undefined || f.score >= 0.3)
    .map((f) => ({
      label: match(f.label),
      box: [clamp(f.box[0] / sx), clamp(f.box[1] / sy), clamp(f.box[2] / sx), clamp(f.box[3] / sy)] as Box,
      ...(f.maskRef ? { maskRef: f.maskRef } : {}),
    }))
    .filter((r) => r.box[2] > r.box[0] && r.box[3] > r.box[1]);
}

/** Fallback: treat the whole image as one region. */
export class WholeImageSegmenter implements Segmenter {
  readonly name = "whole-image";
  async segment(_image: ImageInput, concepts: string[]): Promise<Region[]> {
    return concepts.map((label) => ({ label, box: [0, 0, 1, 1] as [number, number, number, number] }));
  }
}
