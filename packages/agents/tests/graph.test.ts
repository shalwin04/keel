import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import type { AdSnapshot } from "@keel/core";
import type { KeelDeps } from "../src/deps.ts";
import { buildCycleGraph } from "../src/graph.ts";

const snap: AdSnapshot = {
  adId: "ad1",
  adName: "Fleece set — hero",
  status: "ACTIVE",
  creativeId: "cr1",
  originalImageRef: "file://orig.png",
  featuresSpec: { image_background_gen: "OPT_OUT" },
  variants: [{ id: "ad1:v1", adId: "ad1", placement: "fixture", imageRef: "file://v1.png", source: "fixture" }],
};

function fakeDeps(): KeelDeps & { executed: string[] } {
  const executed: string[] = [];
  return {
    executed,
    snapshotAccount: async () => [snap],
    getBaseline: async () => ({ image_background_gen: "OPT_OUT" }),
    screen: async (_s, v) => ({ variantId: v.id, score: 0.9, suspected: ["PERSON_MISMATCH"], note: "model swapped" }),
    inspect: async (_s, v) => [{
      id: "f1", adId: "ad1", variantId: v.id, code: "ANATOMY", severity: "critical", confidence: 0.95,
      summary: "leg bent backwards", evidence: ["left leg"], regions: [], detectedBy: "inspect",
    }],
    notify: vi.fn(async () => {}),
    execute: async (p) => { executed.push(`${p.action}:${p.adId}`); return { ok: true, detail: "verified" }; },
    audit: async () => {},
  };
}

describe("watch cycle", () => {
  it("pauses for approval, then acts once approved", async () => {
    const deps = fakeDeps();
    const graph = buildCycleGraph(deps, undefined, new MemorySaver());
    const cfg = { configurable: { thread_id: "cycle-1" } };

    await graph.invoke({ cycleId: "c1", accountId: "act_1" }, cfg);
    const paused = await graph.getState(cfg);
    expect(paused.next).toContain("requestApproval");
    expect(deps.notify).toHaveBeenCalledOnce();
    expect(deps.executed).toHaveLength(0);

    const proposalId = paused.values.proposals[0]!.id;
    await graph.invoke(new Command({ resume: { proposalId, decision: "approve", decidedBy: "owner", channel: "whatsapp_button" } }), cfg);
    expect(deps.executed).toEqual(["PAUSE_AD:ad1"]);
  });

  it("does nothing when the owner rejects", async () => {
    const deps = fakeDeps();
    const graph = buildCycleGraph(deps, undefined, new MemorySaver());
    const cfg = { configurable: { thread_id: "cycle-2" } };
    await graph.invoke({ cycleId: "c2", accountId: "act_1" }, cfg);
    const proposalId = (await graph.getState(cfg)).values.proposals[0]!.id;
    await graph.invoke(new Command({ resume: { proposalId, decision: "reject", decidedBy: "owner", channel: "whatsapp_button" } }), cfg);
    expect(deps.executed).toHaveLength(0);
  });
});
