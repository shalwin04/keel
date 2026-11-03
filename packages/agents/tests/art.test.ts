import { afterEach, describe, expect, it } from "vitest";
import type { Brief, Direction } from "@keel/core";
import { renderSvgToPng, saveMedia } from "@keel/meta";
import { artBrief, designAd, expectedText } from "../src/studio/art.ts";
import { fakeStudioModels } from "../src/studio/models.ts";

const c: Direction = { title: "Commute notes", angle: "Dry on the train", hook: "Rain-ready", scenePrompt: "rainy train", headline: "Built for the downpour", subline: "Light and waterproof", primaryText: "", cta: "SHOP_NOW",
  palette: { base: "#0f2a3d", accent: "#e0a23b", ink: "#f4efe6" }, rationale: "", art: { camera: "", lighting: "", grade: "", composition: "", props: "", avoid: "" }, storyboard: { beats: [], reel: [] },
  format: "notes", style: "lifestyle", visual: "A commuter on a packed monsoon train, dry and calm",
  copy: { lines: ["Seam-sealed", "380 g"], quote: "", author: "", rows: [], them: "", before: "", after: "", top: "", bottom: "", sticker: "", scene2: "" } };
const brief = async (): Promise<Brief> => ({ productName: "Monsoon Jacket", productUrl: "https://x.test", productPhotos: [await saveMedia(await renderSvgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#14324a"/></svg>`, 200, 200), ".png", "test")],
  referenceImages: [], price: "", offer: "", audience: "", countries: ["IN"], ageMin: 18, ageMax: 65, dailyBudget: 500, startDate: "", endDate: "", notes: "", competitors: [], competitorShots: [], objective: "traffic" });

afterEach(() => { delete process.env.FAKE_DESIGN_TEXT_FAIL; });

describe("art engine", () => {
  it("briefs Muse Image like an art director: story, real product, style, exact text, avoid list", async () => {
    const b = artBrief({ c, brief: await brief(), brand: "Northline", style: "lifestyle", aspect: "9:16", withText: true, productRefs: 1, logoRef: true });
    expect(b).toContain('"Built for the downpour"');
    expect(b).toContain("@Image1");
    expect(b).toContain("@Image2"); // the logo
    expect(b).toContain("Kodak Portra");
    expect(b).toContain("top 14%");
    expect(b).toMatch(/AVOID:.*misspelled/);
    expect(expectedText(c, await brief())).toEqual(["Built for the downpour", "Seam-sealed", "380 g"]);
  });

  it("uses Muse Image's whole design when Spark finds every word exact", async () => {
    const r = await designAd({ models: fakeStudioModels(), c, brief: await brief(), brand: "Northline", aspect: "1:1", takes: 1 });
    expect(r.mode).toBe("generated");
    expect(r.info.check?.pass).toBe(true);
  }, 60_000);

  it("falls back to a text-free key visual when the text isn't exact, so a typo never ships", async () => {
    process.env.FAKE_DESIGN_TEXT_FAIL = "1";
    const r = await designAd({ models: fakeStudioModels(), c, brief: await brief(), brand: "Northline", aspect: "1:1", takes: 1 });
    expect(r.mode).toBe("art");
    expect(r.info.prompt).toContain("NO TEXT");
  }, 60_000);
});
