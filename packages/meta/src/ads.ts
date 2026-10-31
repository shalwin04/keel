import type { FeaturesSpec } from "@keel/core";
import { config } from "./config.ts";

export interface Creative {
  id: string;
  name?: string;
  image_url?: string;
  thumbnail_url?: string;
  image_hash?: string;
  body?: string;
  title?: string;
  link_url?: string;
  object_url?: string;
  call_to_action_type?: string;
  url_tags?: string;
  object_story_spec?: Record<string, unknown>;
  object_story_id?: string;
  effective_object_story_id?: string;
  asset_feed_spec?: Record<string, unknown>;
  degrees_of_freedom_spec?: { creative_features_spec?: Record<string, { enroll_status?: string }> };
}

export class GraphError extends Error {
  constructor(public path: string, message: string, public code?: number, public status?: number, public subcode?: number, public blame: string[] = []) {
    super(`Graph ${path}: ${message}`);
  }
}

type GraphErr = {
  message: string; code?: number; error_subcode?: number; is_transient?: boolean;
  error_user_title?: string; error_user_msg?: string;
  error_data?: { blame_field_specs?: (string | string[])[] } | string;
};

/** Meta hides the useful part of an error in error_user_msg / blame_field_specs; surface it. */
function describe(e: GraphErr | undefined, status: number) {
  if (!e) return { text: `HTTP ${status}`, blame: [] as string[] };
  const data = typeof e.error_data === "string" ? (() => { try { return JSON.parse(e.error_data as string); } catch { return {}; } })() : e.error_data;
  const blame = ((data?.blame_field_specs ?? []) as (string | string[])[]).map((b) => (Array.isArray(b) ? b.join(".") : b));
  const parts = [e.message, e.error_user_title, e.error_user_msg, e.error_subcode && `subcode ${e.error_subcode}`, blame.length && `field ${blame.join(", ")}`].filter(Boolean);
  return { text: [...new Set(parts)].join(" · "), blame };
}

/**
 * Creative features Keel may write back. Read-only or retired keys (Meta reports them, but rejects
 * them on create) are dropped; standard_enhancements was replaced by the individual features.
 */
const UNWRITABLE_FEATURES = new Set(["standard_enhancements", "advantage_plus_creative"]);

const CREATIVE_FIELDS = "id,name,image_url,thumbnail_url,image_hash,body,title,link_url,object_url,call_to_action_type,url_tags,object_story_spec,object_story_id,effective_object_story_id,asset_feed_spec,degrees_of_freedom_spec";

/** Thin Marketing API (Graph) client: the reads a cycle needs and the writes an approved action needs. */
export class AdsGraphClient {
  constructor(
    private token = config.graph.token,
    private version = config.graph.version,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async req<T>(path: string, init: { method?: string; params?: Record<string, unknown> } = {}): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.version}/${path}`);
    const method = init.method ?? "GET";
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(init.params ?? {})) {
      if (v === undefined) continue;
      const val = typeof v === "string" ? v : JSON.stringify(v);
      if (method === "GET") url.searchParams.set(k, val);
      else body.set(k, val);
    }
    url.searchParams.set("access_token", this.token);
    let lastErr: unknown;
    // Transient Graph errors (rate limits, 5xx) get two retries with backoff.
    for (let attempt = 0; attempt < 3; attempt++) {
      // A hung request must never stall a cycle: Graph calls give up after 30 s.
      const res = await this.fetchImpl(url, { method, body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(30_000) });
      const json = (await res.json().catch(() => ({}))) as T & { error?: GraphErr };
      if (res.ok && !json.error) return json;
      const e = json.error;
      const d = describe(e, res.status);
      lastErr = new GraphError(path, d.text, e?.code, res.status, e?.error_subcode, d.blame);
      const transient = res.status >= 500 || e?.is_transient || e?.code === 4 || e?.code === 17 || e?.code === 32 || e?.code === 613;
      if (!transient) break;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
    throw lastErr;
  }

  /** Live ads. With KEEL_INCLUDE_PAUSED=1, paused test ads count too, so a zero-spend test account still has something to watch. */
  async listActiveAds(accountId: string) {
    const statuses = process.env.KEEL_INCLUDE_PAUSED === "1"
      ? ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "PREAPPROVED", "PENDING_BILLING_INFO"]
      : ["ACTIVE"];
    type Page = { data: { id: string; name: string; status: string; effective_status?: string; creative: { id: string } }[]; paging?: { next?: string; cursors?: { after?: string } } };
    const all: Page["data"] = [];
    let after: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await this.req<Page>(`${accountId}/ads`, {
        params: { fields: "id,name,status,effective_status,creative{id}", effective_status: statuses, limit: "100", after },
      });
      all.push(...page.data);
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return { data: all };
  }

  getAccount(accountId: string) {
    return this.req<{ id: string; name: string; account_status: number; currency?: string }>(accountId, { params: { fields: "id,name,account_status,currency" } });
  }

  getCreative(creativeId: string) {
    // Ask for a full-size thumbnail: the default is 64 px, too small to judge.
    return this.req<Creative>(creativeId, { params: { fields: CREATIVE_FIELDS, thumbnail_width: "1080", thumbnail_height: "1080" } });
  }

  /** Full-resolution URL of an image in the account's library, by hash. */
  async imageUrl(accountId: string, hash: string): Promise<string | undefined> {
    const res = await this.req<{ data: { url?: string; permalink_url?: string }[] }>(`${accountId}/adimages`, {
      params: { hashes: [hash], fields: "url,permalink_url" },
    });
    return res.data[0]?.url ?? res.data[0]?.permalink_url;
  }

  async getFeaturesSpec(creativeId: string): Promise<FeaturesSpec> {
    return featuresOf(await this.getCreative(creativeId));
  }

  /** Returns preview iframe HTML per placement. Rendering to an image happens in the variant source. */
  getPreviews(adId: string, adFormat = "MOBILE_FEED_STANDARD") {
    return this.req<{ data: { body: string }[] }>(`${adId}/previews`, { params: { ad_format: adFormat } });
  }

  getAd(adId: string) {
    return this.req<{ id: string; name?: string; status: string; effective_status: string; creative: { id: string } }>(adId, {
      params: { fields: "id,name,status,effective_status,creative{id}" },
    });
  }

  pauseAd(adId: string) {
    return this.req<{ success: boolean }>(adId, { method: "POST", params: { status: "PAUSED" } });
  }

  /** Uploads image bytes to the ad account's library; returns the image hash creatives reference. */
  async uploadImage(accountId: string, bytes: Buffer, name = "keel-replacement.png"): Promise<string> {
    const res = await this.req<{ images: Record<string, { hash: string }> }>(`${accountId}/adimages`, {
      method: "POST", params: { bytes: bytes.toString("base64"), name },
    });
    const first = Object.values(res.images ?? {})[0];
    if (!first?.hash) throw new GraphError(`${accountId}/adimages`, "no image hash returned");
    return first.hash;
  }

  /**
   * Creatives can't be edited, so every corrective action makes a new creative from the current one:
   * same story, enhancements set as given, optionally a new image. Returns the new creative id.
   */
  async cloneCreative(accountId: string, source: Creative, o: { features: FeaturesSpec; imageHash?: string; name?: string }) {
    const params: Record<string, unknown> = {
      name: o.name ?? `${source.name ?? "Creative"} · Keel ${new Date().toISOString().slice(0, 16)}`,
    };
    // Creatives made in today's Ads Manager keep the copy, link and images in asset_feed_spec and only the
    // identity (page) in object_story_spec, so both are copied; a story without a link gets the creative's own.
    if (source.object_story_spec) {
      const story = cleanStory(source.object_story_spec, linkOf(source));
      params.object_story_spec = o.imageHash && !source.asset_feed_spec ? withImage(story, o.imageHash) : story;
    }
    if (source.asset_feed_spec) {
      const feed = cleanFeed(source.asset_feed_spec);
      params.asset_feed_spec = o.imageHash ? { ...feed, images: [{ hash: o.imageHash }] } : feed;
    }
    if (source.url_tags) params.url_tags = source.url_tags;
    if (!params.object_story_spec && !params.asset_feed_spec) {
      const postId = source.object_story_id ?? source.effective_object_story_id;
      if (!postId) throw new GraphError("adcreatives", "creative has no story spec Keel can copy");
      if (o.imageHash) throw new GraphError("adcreatives", "this ad uses an existing post, so its image can't be replaced");
      params.object_story_id = postId;
    }
    return this.postCreative(accountId, params, o.features, JSON.stringify({ ...source, degrees_of_freedom_spec: undefined }));
  }

  /**
   * Posts a creative with explicit enhancement switches. Meta rejects some keys it reports (retired, or not
   * valid for this format): known ones are dropped, then any key Meta blames, then a minimal set.
   */
  async postCreative(accountId: string, params: Record<string, unknown>, wanted: FeaturesSpec, debugSource?: string): Promise<string> {
    let features = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => !UNWRITABLE_FEATURES.has(k) && (v === "OPT_IN" || v === "OPT_OUT")));
    for (let attempt = 0; attempt < 4; attempt++) {
      const body = { ...params, degrees_of_freedom_spec: { creative_features_spec: Object.fromEntries(Object.entries(features).map(([k, v]) => [k, { enroll_status: v }])) } };
      try {
        return (await this.req<{ id: string }>(`${accountId}/adcreatives`, { method: "POST", params: body })).id;
      } catch (err) {
        if (attempt === 0 && debugSource && process.env.KEEL_DEBUG_GRAPH !== "0") {
          console.warn(`[keel] creative rejected: ${(err as Error).message}\n[keel] source creative: ${debugSource.slice(0, 3000)}`);
        }
        if (err instanceof GraphError && err.subcode === 1885183) {
          throw new GraphError("adcreatives", "Meta only lets apps in Live mode create ad creatives. Switch the Keel app to Live in developers.facebook.com (App settings → Basic, then the App mode toggle), then try again. Pausing works in either mode.", err.code, err.status, err.subcode);
        }
        if (!(err instanceof GraphError) || err.code !== 100) throw err;
        // A missing story field isn't about features: retrying with fewer switches won't help.
        if (err.blame.some((b) => !b.includes("creative_features_spec") && !b.includes("degrees_of_freedom"))) throw err;
        const blamed = Object.keys(features).filter((k) => err.blame.some((b) => b.includes(k)) || err.message.includes(k));
        if (blamed.length) { features = Object.fromEntries(Object.entries(features).filter(([k]) => !blamed.includes(k))); continue; }
        if (attempt <= 1 && Object.values(features).some((v) => v === "OPT_IN")) { features = Object.fromEntries(Object.entries(features).filter(([, v]) => v === "OPT_OUT")); continue; }
        if (attempt <= 2 && Object.keys(features).length) { features = {}; continue; }
        throw err;
      }
    }
    throw new GraphError("adcreatives", "Meta kept rejecting the creative's enhancement settings");
  }

  // ── Studio launch: campaign → ad set → creative → ad, all created PAUSED ─────

  async promotePages(accountId: string) {
    const res = await this.req<{ data: { id: string; name: string }[] }>(`${accountId}/promote_pages`, { params: { fields: "id,name", limit: "50" } });
    return res.data;
  }

  /** Posts, dropping optional fields Meta says it doesn't accept on this API version. */
  private async postTolerant<T>(path: string, params: Record<string, unknown>, optional: string[]): Promise<T> {
    let p = { ...params };
    for (let attempt = 0; attempt <= optional.length; attempt++) {
      try {
        return await this.req<T>(path, { method: "POST", params: p });
      } catch (err) {
        if (!(err instanceof GraphError)) throw err;
        const drop = optional.find((k) => k in p && (err.blame.some((b) => b.includes(k)) || err.message.includes(k)));
        if (!drop) throw err;
        const { [drop]: _, ...rest } = p;
        p = rest;
      }
    }
    throw new GraphError(path, "could not satisfy Meta's required fields");
  }

  createCampaign(accountId: string, name: string) {
    return this.postTolerant<{ id: string }>(`${accountId}/campaigns`, {
      name, objective: "OUTCOME_TRAFFIC", status: "PAUSED", special_ad_categories: [], is_adset_budget_sharing_enabled: false, buying_type: "AUCTION",
    }, ["is_adset_budget_sharing_enabled", "buying_type"]);
  }

  createAdSet(accountId: string, o: { campaignId: string; name: string; dailyBudgetMinor: number; countries: string[]; ageMin: number; ageMax: number; start: string; end: string }) {
    return this.postTolerant<{ id: string }>(`${accountId}/adsets`, {
      name: o.name, campaign_id: o.campaignId, status: "PAUSED",
      daily_budget: Math.round(o.dailyBudgetMinor), billing_event: "IMPRESSIONS", optimization_goal: "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP", destination_type: "WEBSITE",
      targeting: { geo_locations: { countries: o.countries }, age_min: o.ageMin, age_max: o.ageMax, targeting_automation: { advantage_audience: 0 } },
      start_time: o.start, end_time: o.end,
    }, ["destination_type", "bid_strategy"]);
  }

  createAd(accountId: string, o: { adsetId: string; creativeId: string; name: string }) {
    return this.req<{ id: string }>(`${accountId}/ads`, { method: "POST", params: { name: o.name, adset_id: o.adsetId, creative: { creative_id: o.creativeId }, status: "PAUSED" } });
  }

  swapCreative(adId: string, creativeId: string) {
    return this.req<{ success: boolean }>(adId, { method: "POST", params: { creative: { creative_id: creativeId } } });
  }
}

export function featuresOf(c: Creative): FeaturesSpec {
  const spec = c.degrees_of_freedom_spec?.creative_features_spec ?? {};
  return Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v.enroll_status ?? "UNKNOWN"]));
}

/** The approved image of a creative, wherever this creative type keeps it. */
/** The library hash of a creative's image, when it uses one instead of a URL. */
export function imageHashOf(c: Creative): string | undefined {
  const s = c.object_story_spec as { link_data?: { image_hash?: string }; photo_data?: { image_hash?: string } } | undefined;
  return c.image_hash ?? s?.link_data?.image_hash ?? s?.photo_data?.image_hash;
}

export function originalImageOf(c: Creative): string | undefined {
  const s = c.object_story_spec as { link_data?: { picture?: string; image_url?: string }; photo_data?: { url?: string; image_url?: string } } | undefined;
  return c.image_url ?? s?.link_data?.picture ?? s?.link_data?.image_url ?? s?.photo_data?.url ?? s?.photo_data?.image_url ?? c.thumbnail_url;
}

/** Where this creative sends people, wherever Meta stored it. */
function linkOf(c: Creative): string | undefined {
  const s = c.object_story_spec as { link_data?: { link?: string; call_to_action?: { value?: { link?: string } } }; video_data?: { call_to_action?: { value?: { link?: string } } } } | undefined;
  const feed = c.asset_feed_spec as { link_urls?: { website_url?: string }[] } | undefined;
  return s?.link_data?.link ?? s?.link_data?.call_to_action?.value?.link ?? s?.video_data?.call_to_action?.value?.link
    ?? feed?.link_urls?.[0]?.website_url ?? c.link_url ?? c.object_url;
}

/** A story spec as read back carries both the image hash and its CDN url (rejected together) and can lack its link. */
function cleanStory(spec: Record<string, unknown>, link?: string): Record<string, unknown> {
  const out = structuredClone(spec);
  for (const key of ["link_data", "photo_data", "video_data"]) {
    const d = out[key] as Record<string, unknown> | undefined;
    if (!d) continue;
    if (d.image_hash) { delete d.picture; delete d.image_url; }
    if (key === "link_data" && !d.link && link) d.link = link;
  }
  return out;
}

/** asset_feed_spec as read back: images and videos carry both hash/id and URLs; keep the identifiers. */
function cleanFeed(feed: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(feed);
  if (Array.isArray(out.images)) out.images = (out.images as Record<string, unknown>[]).map((i) => (i.hash ? { hash: i.hash, ...(i.adlabels ? { adlabels: i.adlabels } : {}) } : i));
  if (Array.isArray(out.videos)) out.videos = (out.videos as Record<string, unknown>[]).map((v) => (v.video_id ? { video_id: v.video_id, ...(v.thumbnail_hash ? { thumbnail_hash: v.thumbnail_hash } : {}), ...(v.adlabels ? { adlabels: v.adlabels } : {}) } : v));
  return out;
}

function withImage(spec: Record<string, unknown>, hash: string): Record<string, unknown> {
  const out = structuredClone(spec);
  const link = out.link_data as Record<string, unknown> | undefined;
  if (link) {
    delete link.picture; delete link.image_url;
    link.image_hash = hash;
    return out;
  }
  const photo = out.photo_data as Record<string, unknown> | undefined;
  if (photo) {
    delete photo.url; delete photo.image_url;
    photo.image_hash = hash;
    return out;
  }
  throw new GraphError("adcreatives", "only single-image link or photo ads can have their image replaced");
}
