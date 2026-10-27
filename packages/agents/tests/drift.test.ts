import { describe, expect, it } from "vitest";
import { diffFeatures } from "../src/drift.ts";

describe("diffFeatures", () => {
  it("flags an enhancement switched on since the baseline", () => {
    const f = diffFeatures("ad1", { image_background_gen: "OPT_OUT" }, { image_background_gen: "OPT_IN" });
    expect(f).toHaveLength(1);
    expect(f[0]?.code).toBe("SETTING_DRIFT");
  });
  it("ignores unchanged settings", () => {
    expect(diffFeatures("ad1", { text_optimizations: "OPT_IN" }, { text_optimizations: "OPT_IN" })).toHaveLength(0);
  });
  it("flags locked enhancements even without a baseline", () => {
    const f = diffFeatures("ad1", undefined, { music_generation: "DEFAULT_OPT_IN" }, ["music_generation"]);
    expect(f[0]?.severity).toBe("high");
  });
});
