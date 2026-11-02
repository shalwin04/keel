/**
 * Runs only the research agent against real sites and Meta's models, printing what it does as it goes.
 *   npm run research:agent -- "Monsoon rain jacket" decathlon.in wildcraft.com
 * The first argument is the product; the rest are competitors (names or website addresses). Market: RESEARCH_COUNTRY (default IN).
 */
import { gatherResearch, metaStudioModels } from "@keel/agents";

const [product = "Rain jacket", ...competitors] = process.argv.slice(2);
const t0 = Date.now();
const research = await gatherResearch({
  models: metaStudioModels((i) => console.log(`    · ${i.step} ${i.model} ${(i.ms / 1000).toFixed(1)} s`)),
  brand: "Test brand",
  brief: {
    productName: product, productUrl: "https://example.com", productPhotos: ["unused"], referenceImages: [], price: "", offer: "", audience: "",
    countries: [process.env.RESEARCH_COUNTRY ?? "IN"], ageMin: 18, ageMax: 65, dailyBudget: 500, startDate: "", endDate: "", notes: "", competitors, competitorShots: [],
  },
  log: async (text, kind = "info") => console.log(`${kind === "decision" ? "▸" : kind === "warn" ? "!" : " "} ${text}`),
});
console.log(`\n■ ${research.ads.length} sources (${research.source}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(JSON.stringify(research.insights, null, 2));
process.exit(0);
