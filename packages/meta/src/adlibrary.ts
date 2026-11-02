import { networkReason } from "./ads.ts";
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

/** The token can't use the Ad Library API (no identity confirmation). Research falls back to competitors' websites. */
export class AdLibraryAccessError extends Error {}

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
  u.searchParams.set("access_token", o.token ?? config.graph.adLibraryToken);
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try { res = await fetch(u, { signal: AbortSignal.timeout(30_000) }); }
    catch (err) {
      if (attempt === 2) throw new Error(`Ad Library: couldn't reach Meta (${networkReason(err)})`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  if (!res) throw new Error("Ad Library: no response");
  const json = (await res.json()) as { data?: LibraryAd[]; error?: { message: string; error_user_msg?: string; code?: number; error_subcode?: number } };
  if (json.error?.error_subcode === 2332002 || json.error?.code === 10) {
    throw new AdLibraryAccessError("Ad Library access isn't set up: it needs a token from a person who has confirmed their identity with Meta (facebook.com/ads/library/api), in META_AD_LIBRARY_TOKEN");
  }
  if (json.error) throw new Error(`Ad Library: ${json.error.error_user_msg ?? json.error.message}`);
  return json.data ?? [];
}

export const libraryUrl = (id: string) => `https://www.facebook.com/ads/library/?id=${id}`;
