import { describe, expect, it } from "vitest";
import type { Finding, Proposal } from "@keel/core";
import { AdsGraphClient } from "@keel/meta";
import { executeAction, verifyAction } from "../src/actions.ts";

/** A tiny in-memory Marketing API: one ad, creatives by id, records every write. */
function fakeGraph() {
  const creatives: Record<string, Record<string, unknown>> = {
    cr1: {
      id: "cr1", name: "Hero",
      object_story_spec: { page_id: "p1", link_data: { link: "https://x.test", message: "Hi", picture: "https://cdn.test/a.jpg" } },
      degrees_of_freedom_spec: { creative_features_spec: { image_touchups: { enroll_status: "OPT_IN" }, text_optimizations: { enroll_status: "OPT_OUT" } } },
    },
  };
  const ad = { id: "ad1", status: "ACTIVE", effective_status: "ACTIVE", creative: { id: "cr1" } };
  const writes: { path: string; params: Record<string, string> }[] = [];
  let n = 1;
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.split("/").slice(2).join("/");
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (init?.method === "POST") {
      const params = Object.fromEntries(new URLSearchParams(String(init.body)));
      writes.push({ path, params });
      if (path.endsWith("/adcreatives")) {
        const id = `cr${++n}`;
        const dof = JSON.parse(params.degrees_of_freedom_spec!);
        creatives[id] = { id, object_story_spec: JSON.parse(params.object_story_spec!), degrees_of_freedom_spec: dof };
        return json({ id });
      }
      if (path.endsWith("/adimages")) return json({ images: { "x.png": { hash: "hash123" } } });
      if (path === "ad1") {
        if (params.status) ad.status = params.status;
        if (params.creative) ad.creative = { id: JSON.parse(params.creative).creative_id };
        return json({ success: true });
      }
    }
    if (path === "ad1") return json(ad);
    if (creatives[path]) return json(creatives[path]);
    return new Response(JSON.stringify({ error: { message: "unknown " + path } }), { status: 400 });
  }) as typeof fetch;
  return { ads: new AdsGraphClient("token", "v24.0", fetchImpl), writes, ad, creatives };
}

const proposal = (action: Proposal["action"]): Proposal => ({ id: "p1", adId: "ad1", action, findingIds: ["f1"], reason: "", requiresApproval: true, expiresAt: new Date().toISOString() });
const drift: Finding = { id: "f1", adId: "ad1", code: "SETTING_DRIFT", severity: "medium", confidence: 1, summary: "image_touchups is OPT_IN", evidence: ["creative_features_spec.image_touchups"], regions: [], detectedBy: "drift" };

describe("actions against the Marketing API", () => {
  it("relock: clones the creative with the drifted setting off, swaps it in, and verifies", async () => {
    const g = fakeGraph();
    const env = { ads: g.ads, accountId: "act_1" };
    const res = await executeAction(env, proposal("RELOCK_SETTING"), undefined, { findings: [drift] });
    expect(res.ok).toBe(true);
    expect(res.data?.optedOut).toEqual(["image_touchups"]);
    expect(g.ad.creative.id).toBe(res.data?.creativeId);
    const created = g.creatives[res.data!.creativeId as string]!;
    expect((created.degrees_of_freedom_spec as { creative_features_spec: Record<string, { enroll_status: string }> }).creative_features_spec.image_touchups!.enroll_status).toBe("OPT_OUT");
    expect((await verifyAction(env, proposal("RELOCK_SETTING"), res)).ok).toBe(true);
  });

  it("revert: turns every enhancement off", async () => {
    const g = fakeGraph();
    const res = await executeAction({ ads: g.ads, accountId: "act_1" }, proposal("REVERT_CREATIVE"), undefined, { findings: [] });
    expect(res.data?.features).toEqual({ image_touchups: "OPT_OUT", text_optimizations: "OPT_OUT" });
  });

  it("replace: generates an image, uploads it and swaps a creative that uses its hash", async () => {
    const g = fakeGraph();
    const res = await executeAction(
      { ads: g.ads, accountId: "act_1", generate: async () => Buffer.from("png"), load: async () => ({ url: "x" }) },
      proposal("PAUSE_AD"),
      { proposalId: "p1", decision: "replace", decidedBy: "u1", channel: "web" },
      { findings: [drift], snapshot: { adId: "ad1", adName: "a", status: "ACTIVE", creativeId: "cr1", originalImageRef: "https://cdn.test/a.jpg", featuresSpec: {}, variants: [] } },
    );
    expect(res.ok).toBe(true);
    const story = g.creatives[res.data!.creativeId as string]!.object_story_spec as { link_data: Record<string, unknown> };
    expect(story.link_data.image_hash).toBe("hash123");
    expect(story.link_data.picture).toBeUndefined();
  });

  it("pause: pauses and verifies from Meta's read-back", async () => {
    const g = fakeGraph();
    const env = { ads: g.ads, accountId: "act_1" };
    const res = await executeAction(env, proposal("PAUSE_AD"), undefined, { findings: [] });
    expect(g.ad.status).toBe("PAUSED");
    expect((await verifyAction(env, proposal("PAUSE_AD"), res)).ok).toBe(true);
  });

  it("verify fails if Meta still serves the old creative", async () => {
    const g = fakeGraph();
    const v = await verifyAction({ ads: g.ads, accountId: "act_1" }, proposal("RELOCK_SETTING"), { ok: true, detail: "", data: { action: "RELOCK_SETTING", creativeId: "cr9", optedOut: ["x"] } });
    expect(v.ok).toBe(false);
  });
});

describe("cloneCreative resilience", () => {
  it("drops retired keys, then any key Meta blames, and cleans the read-back story", async () => {
    const sent: Record<string, unknown>[] = [];
    let calls = 0;
    const fetchImpl = (async (_u: URL | RequestInfo, init?: RequestInit) => {
      const p = Object.fromEntries(new URLSearchParams(String(init?.body)));
      sent.push({ features: Object.keys(JSON.parse(p.degrees_of_freedom_spec!).creative_features_spec), story: JSON.parse(p.object_story_spec!) });
      if (++calls === 1) return new Response(JSON.stringify({ error: { message: "Invalid parameter", code: 100, error_user_msg: "inline_comment is not supported" } }), { status: 400 });
      return new Response(JSON.stringify({ id: "new1" }), { status: 200 });
    }) as typeof fetch;
    const ads = new AdsGraphClient("t", "v24.0", fetchImpl);
    const id = await ads.cloneCreative("act_1", {
      id: "c1", object_story_spec: { page_id: "p", link_data: { image_hash: "h", picture: "https://cdn/x.jpg", link: "https://x" } },
    }, { features: { standard_enhancements: "OPT_IN", inline_comment: "OPT_IN", image_touchups: "OPT_OUT" } });
    expect(id).toBe("new1");
    expect(sent[0]!.features).toEqual(["inline_comment", "image_touchups"]);
    expect(sent[1]!.features).toEqual(["image_touchups"]);
    expect((sent[0]!.story as { link_data: Record<string, unknown> }).link_data.picture).toBeUndefined();
  });
});

describe("cloneCreative with asset_feed_spec (today's Ads Manager creatives)", () => {
  it("copies both specs, fills the story's link and strips feed image urls", async () => {
    let body: Record<string, string> = {};
    const fetchImpl = (async (_u: URL | RequestInfo, init?: RequestInit) => {
      body = Object.fromEntries(new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify({ id: "n1" }), { status: 200 });
    }) as typeof fetch;
    await new AdsGraphClient("t", "v24.0", fetchImpl).cloneCreative("act_1", {
      id: "c1",
      object_story_spec: { page_id: "p", link_data: { image_hash: "h" } },
      asset_feed_spec: { images: [{ hash: "h", url: "https://cdn/x.jpg" }], link_urls: [{ website_url: "https://shop.test" }], bodies: [{ text: "Hi" }] },
    }, { features: { image_touchups: "OPT_OUT" } });
    expect(JSON.parse(body.object_story_spec!).link_data.link).toBe("https://shop.test");
    expect(JSON.parse(body.asset_feed_spec!).images).toEqual([{ hash: "h" }]);
  });
});
