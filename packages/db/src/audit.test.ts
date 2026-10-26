import { describe, expect, it } from "vitest";
import { GENESIS, chain, verifyChain } from "./audit.ts";

describe("hash-chained audit log", () => {
  const a = chain(GENESIS, "keel", "finding.created", { id: "f1" });
  const b = chain(a.hash, "owner", "proposal.approved", { id: "p1" });

  it("verifies an intact chain", () => expect(verifyChain([a, b])).toBe(-1));
  it("detects a tampered payload", () =>
    expect(verifyChain([a, { ...b, payload: { id: "p2" } }])).toBe(1));
});
