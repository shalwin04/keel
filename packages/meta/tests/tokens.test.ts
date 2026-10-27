import { describe, expect, it } from "vitest";
import { decodeButtonId, encodeButtonId } from "../src/tokens.ts";

describe("approval button tokens", () => {
  it("round-trips", () => {
    expect(decodeButtonId(encodeButtonId("p1", "approve"))).toEqual({ proposalId: "p1", decision: "approve" });
  });
  it("rejects a tampered decision", () => {
    const id = encodeButtonId("p1", "reject").replace("reject", "approve");
    expect(decodeButtonId(id)).toBeNull();
  });
});
