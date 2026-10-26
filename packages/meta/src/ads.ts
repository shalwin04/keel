import type { FeaturesSpec } from "@keel/core";
import { config } from "./config.ts";

/** Thin Marketing API (Graph) client for the calls the Ads MCP doesn't expose. */
export class AdsGraphClient {
  constructor(
    private token = config.graph.token,
    private version = config.graph.version,
  ) {}

  private async req<T>(path: string, init: { method?: string; params?: Record<string, unknown> } = {}): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.version}/${path}`);
    const method = init.method ?? "GET";
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(init.params ?? {})) {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      if (method === "GET") url.searchParams.set(k, val);
      else body.set(k, val);
    }
    url.searchParams.set("access_token", this.token);
    const res = await fetch(url, { method, body: method === "GET" ? undefined : body });
    const json = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok || json.error) throw new Error(`Graph ${path}: ${json.error?.message ?? res.status}`);
    return json;
  }

  listActiveAds(accountId: string) {
    return this.req<{ data: { id: string; name: string; status: string; creative: { id: string } }[] }>(
      `${accountId}/ads`,
      { params: { fields: "id,name,status,creative{id}", effective_status: ["ACTIVE"], limit: "200" } },
    );
  }

  getCreative(creativeId: string) {
    return this.req<{
      id: string;
      image_url?: string;
      body?: string;
      object_story_spec?: unknown;
      degrees_of_freedom_spec?: { creative_features_spec?: Record<string, { enroll_status?: string }> };
    }>(creativeId, {
      params: { fields: "id,image_url,body,object_story_spec,degrees_of_freedom_spec" },
    });
  }

  async getFeaturesSpec(creativeId: string): Promise<FeaturesSpec> {
    const c = await this.getCreative(creativeId);
    const spec = c.degrees_of_freedom_spec?.creative_features_spec ?? {};
    return Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v.enroll_status ?? "UNKNOWN"]));
  }

  /** Returns preview iframe HTML per placement. Rendering to an image happens in the variant source. */
  getPreviews(adId: string, adFormat = "MOBILE_FEED_STANDARD") {
    return this.req<{ data: { body: string }[] }>(`${adId}/previews`, { params: { ad_format: adFormat } });
  }

  pauseAd(adId: string) {
    return this.req<{ success: boolean }>(adId, { method: "POST", params: { status: "PAUSED" } });
  }

  /** Creatives are treated as immutable: a "revert" is a new creative with enhancements opted out. */
  createCreative(accountId: string, objectStorySpec: unknown, optOut: string[]) {
    const creative_features_spec = Object.fromEntries(optOut.map((k) => [k, { enroll_status: "OPT_OUT" }]));
    return this.req<{ id: string }>(`${accountId}/adcreatives`, {
      method: "POST",
      params: { object_story_spec: objectStorySpec, degrees_of_freedom_spec: { creative_features_spec } },
    });
  }

  swapCreative(adId: string, creativeId: string) {
    return this.req<{ success: boolean }>(adId, { method: "POST", params: { creative: { creative_id: creativeId } } });
  }
}
