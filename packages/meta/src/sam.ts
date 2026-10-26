import type { Region } from "@keel/core";
import { config } from "./config.ts";
import type { ImageInput } from "./models.ts";

/** Region isolation. SAM 3.1 behind an interface so the API shape can change without touching the agent. */
export interface Segmenter {
  segment(image: ImageInput, concepts: string[]): Promise<Region[]>;
}

/**
 * SAM 3.1 through the Meta Model API Responses endpoint.
 * TODO(day 1): confirm request fields and the mask/box format against dev.meta.ai/docs/sam.
 */
export class MetaSamSegmenter implements Segmenter {
  async segment(image: ImageInput, concepts: string[]): Promise<Region[]> {
    const res = await fetch(`${config.metaApiBase}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.metaApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.models.sam,
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: "url" in image ? image.url : image.dataUrl },
              { type: "input_text", text: concepts.join(", ") },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`SAM ${res.status}: ${await res.text()}`);
    return parseSamOutput(await res.json(), concepts);
  }
}

/** Placeholder parser — replace once the real output format is confirmed. */
export function parseSamOutput(_json: unknown, _concepts: string[]): Region[] {
  return [];
}

/** Fallback: treat the whole image as one region. */
export class WholeImageSegmenter implements Segmenter {
  async segment(_image: ImageInput, concepts: string[]): Promise<Region[]> {
    return concepts.map((label) => ({ label, box: [0, 0, 1, 1] as [number, number, number, number] }));
  }
}
