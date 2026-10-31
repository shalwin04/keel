import { describe, expect, it } from "vitest";
import { parseSamOutput } from "../src/sam.ts";
import { previewIframeSrc } from "../src/variants.ts";

const C = ["person", "product", "logo"];

describe("SAM output parsing", () => {
  it("reads normalised xyxy boxes with labels", () => {
    const r = parseSamOutput({ output: [{ detections: [{ label: "person", box: [0.1, 0.2, 0.5, 0.9], score: 0.9 }] }] }, C);
    expect(r).toEqual([{ label: "person", box: [0.1, 0.2, 0.5, 0.9] }]);
  });
  it("normalises pixel boxes using the stated image size", () => {
    const r = parseSamOutput({ width: 1000, height: 500, masks: [{ concept: "logo", bbox: [100, 50, 300, 250] }] }, C);
    expect(r[0]!.box).toEqual([0.1, 0.1, 0.3, 0.5]);
  });
  it("handles results keyed by concept and JSON inside text parts", () => {
    const text = JSON.stringify({ product: [{ bounding_box: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 } }] });
    const r = parseSamOutput({ output: [{ content: [{ type: "output_text", text }] }] }, C);
    expect(r[0]!.label).toBe("product");
    expect(r[0]!.box[2]).toBeCloseTo(0.5);
  });
  it("drops low-score detections and returns [] for unknown shapes", () => {
    expect(parseSamOutput({ detections: [{ label: "person", box: [0, 0, 1, 1], score: 0.1 }] }, C)).toEqual([]);
    expect(parseSamOutput({ hello: "world" }, C)).toEqual([]);
  });
});

describe("preview iframe", () => {
  it("extracts and unescapes the src", () => {
    expect(previewIframeSrc('<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=1&amp;t=2" width="540"></iframe>'))
      .toBe("https://www.facebook.com/ads/api/preview_iframe.php?d=1&t=2");
  });
});
