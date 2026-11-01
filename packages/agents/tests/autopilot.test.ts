import { describe, expect, it } from "vitest";
import type { AdPerformance, Learning, PerformanceSnapshot } from "@keel/core";
import { formatPrice, planMoves } from "../src/autopilot.ts";

const ad = (direction: number, impressions: number, ctr: number, status = "ACTIVE"): AdPerformance => ({ adId: `ad${direction}`, direction, title: `D${direction}`, status, impressions, reach: impressions, clicks: Math.round((impressions * ctr) / 100), ctr, cpc: 5, spend: impressions / 5, frequency: 1.5 });
const snap = (ads: AdPerformance[]): PerformanceSnapshot => ({ at: "2026-11-02T00:00:00Z", currency: "INR", ads, totals: { impressions: ads.reduce((s, a) => s + a.impressions, 0), clicks: 0, spend: ads.reduce((s, a) => s + a.spend, 0), ctr: 1 } });
const settings = { dailyBudget: 500, maxDailyBudget: 1000, checkEveryHours: 6, minImpressions: 1000 };
const launch = { campaignId: "c", adsetId: "s", pageId: "p", ads: [], at: "", active: true };
const learning: Learning = { at: "", impressions: 0, summary: "", winner: 0, confidence: "high", learnings: [], nextIdea: { basedOn: 0, title: "T", angle: "a", hook: "h", headline: "H", subline: "s", primaryText: "p", scenePrompt: "x", why: "w" } };

describe("planMoves", () => {
  it("proposes nothing before ads have enough impressions", () => {
    expect(planMoves({ perf: snap([ad(0, 400, 3), ad(1, 300, 0.2)]), learning: { ...learning, confidence: "low", nextIdea: null }, settings, launch, existing: [], directions: 3 })).toEqual([]);
  });
  it("pauses an ad under half the best CTR, raises budget within the cap, and adds a variant", () => {
    const kinds = planMoves({ perf: snap([ad(0, 3000, 2.5), ad(1, 3000, 0.7), ad(2, 3000, 1.9)]), learning, settings, launch, existing: [], directions: 3 }).map((m) => m.kind);
    expect(kinds).toEqual(["pause_ad", "scale_budget", "new_variant"]);
  });
  it("never pauses the last active ad or exceeds the budget cap", () => {
    const moves = planMoves({ perf: snap([ad(0, 3000, 2.5), ad(1, 3000, 0.7, "PAUSED")]), learning: { ...learning, nextIdea: null }, settings: { ...settings, maxDailyBudget: 600 }, launch, existing: [], directions: 3 });
    expect(moves).toEqual([]);
  });
  it("doesn't repeat a move that's already waiting", () => {
    const existing = [{ id: "m", kind: "new_variant" as const, title: "", why: "", params: {}, status: "pending" as const, createdAt: "" }];
    expect(planMoves({ perf: snap([ad(0, 3000, 2.5)]), learning, settings, launch: { ...launch, active: false }, existing, directions: 3 })).toEqual([]);
  });
});

describe("formatPrice", () => {
  it("formats store prices in the shop's currency", () => {
    expect(formatPrice("3499.00", "INR", "IN")).toBe("₹3,499");
    expect(formatPrice("49.5", undefined, "US")).toBe("$49.50");
    expect(formatPrice("₹1,299", undefined, "IN")).toBe("₹1,299");
  });
});
