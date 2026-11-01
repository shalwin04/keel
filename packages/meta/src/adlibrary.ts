import { config } from "./config.ts";

export interface LibraryAd {
  id: string;
  page_id?: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_snapshot_url?: string;
  publisher_platforms?: string[];
}

/** EU countries, where Meta's Ad Library API lists ordinary commercial ads (elsewhere it lists political ads only). */
export const AD_LIBRARY_EU = ["FR", "DE", "IE", "NL", "ES", "IT"];

const FIELDS = "id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,publisher_platforms";

/** Meta Ad Library API (ads_archive). Needs a token from an identity-confirmed Facebook account. */
export async function searchAdLibrary(o: { terms: string; countries: string[]; limit?: number; token?: string }): Promise<LibraryAd[]> {
  const u = new URL(`https://graph.facebook.com/${config.graph.version}/ads_archive`);
  u.searchParams.set("search_terms", o.terms);
  u.searchParams.set("ad_reached_countries", JSON.stringify(o.countries));
  u.searchParams.set("ad_active_status", "ALL");
  u.searchParams.set("ad_type", "ALL");
  u.searchParams.set("limit", String(o.limit ?? 25));
  u.searchParams.set("fields", FIELDS);
  u.searchParams.set("access_token", o.token ?? config.graph.token);
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
  const json = (await res.json()) as { data?: LibraryAd[]; error?: { message: string; error_user_msg?: string } };
  if (json.error) throw new Error(`Ad Library: ${json.error.error_user_msg ?? json.error.message}`);
  return json.data ?? [];
}

export const libraryUrl = (id: string) => `https://www.facebook.com/ads/library/?id=${id}`;
