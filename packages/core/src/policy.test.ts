import { describe, expect, it } from "vitest";
import { decide } from "./policy.ts";
import type { Finding } from "./schemas.ts";

const f = (p: Partial<Finding>): Finding => ({
  id: p.id ?? "f1",
  adId: p.adId ?? "ad1",
  code: p.code ?? "ANATOMY",
  severity: p.severity ?? "critical",
  confidence: p.confidence ?? 0.9,
  summary: p.summary ?? "twisted leg",
  evidence: [],
  regions: [],
  detectedBy: "inspect",
});

describe("decide", () => {
  it("pauses on a confident critical finding and requires approval", () => {
    const [p] = decide([f({})], undefined);
    expect(p?.action).toBe("PAUSE_AD");
    expect(p?.requiresApproval).toBe(true);
  });

  it("only logs low-confidence findings", () => {
    const [p] = decide([f({ confidence: 0.3 })], undefined);
    expect(p?.action).toBe("LOG");
    expect(p?.requiresApproval).toBe(false);
  });

  it("relocks drifted settings", () => {
    const [p] = decide([f({ code: "SETTING_DRIFT", severity: "medium" })], undefined);
    expect(p?.action).toBe("RELOCK_SETTING");
  });

  it("keeps the strongest action per ad", () => {
    const ps = decide([f({ id: "a", code: "SETTING_DRIFT", severity: "medium" }), f({ id: "b" })], undefined);
    expect(ps).toHaveLength(1);
    expect(ps[0]?.action).toBe("PAUSE_AD");
    expect(ps[0]?.findingIds).toEqual(["a", "b"]);
  });
});
