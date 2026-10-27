import { describe, expect, it } from "vitest";
import { canDecide } from "../src/roles.ts";

describe("canDecide", () => {
  it("lets owners decide anything", () => expect(canDecide("owner", "PAUSE_AD", "approve")).toBe(true));
  it("never lets viewers decide", () => expect(canDecide("viewer", "LOG", "reject")).toBe(false));
  it("lets reviewers revert but not pause", () => {
    expect(canDecide("reviewer", "REVERT_CREATIVE", "approve")).toBe(true);
    expect(canDecide("reviewer", "PAUSE_AD", "approve")).toBe(false);
    expect(canDecide("reviewer", "REPLACE_CREATIVE", "replace")).toBe(false);
  });
  it("lets reviewers reject anything", () => expect(canDecide("reviewer", "PAUSE_AD", "reject")).toBe(true));
});
