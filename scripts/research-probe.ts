/**
 * Checks the two things Studio's research agent needs: Meta Ad Library API access and tool calling on Muse Wonder.
 *   npm run research:probe -- "rain jacket"
 */
const term = process.argv[2] ?? "rain jacket";
const token = process.env.META_AD_LIBRARY_TOKEN || process.env.META_SYSTEM_USER_TOKEN;
const v = process.env.META_GRAPH_VERSION ?? "v24.0";
const base = process.env.META_API_BASE ?? "https://api.meta.ai/v1";

/** fetch with three tries; a dropped connection prints its real reason instead of crashing the probe. */
async function get(u: URL | string, init?: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try { return await fetch(u, { ...init, signal: AbortSignal.timeout(30_000) }); }
    catch (err) {
      const e = err as { cause?: { code?: string; message?: string }; message?: string };
      const why = e.cause?.code ?? e.cause?.message ?? e.message;
      console.log(`  ! ${new URL(String(u)).host}: ${why} (try ${attempt} of 3)`);
      if (attempt === 3) throw new Error(`couldn't reach ${new URL(String(u)).host}: ${why}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function adLibrary(countries: string[]) {
  const u = new URL(`https://graph.facebook.com/${v}/ads_archive`);
  u.searchParams.set("search_terms", term);
  u.searchParams.set("ad_reached_countries", JSON.stringify(countries));
  u.searchParams.set("ad_active_status", "ALL");
  u.searchParams.set("ad_type", "ALL");
  u.searchParams.set("limit", "5");
  u.searchParams.set("fields", "id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,publisher_platforms");
  u.searchParams.set("access_token", token ?? "");
  const res = await get(u);
  const json = (await res.json()) as { data?: { page_name?: string; ad_creative_bodies?: string[]; ad_delivery_start_time?: string }[]; error?: { message: string; code?: number; error_subcode?: number } };
  console.log(`\n■ Ad Library ${JSON.stringify(countries)}: HTTP ${res.status}`);
  if (json.error) console.log(`  error: ${json.error.message} (code ${json.error.code}, subcode ${json.error.error_subcode})`);
  for (const a of json.data ?? []) console.log(`  · ${a.page_name} · since ${a.ad_delivery_start_time} · ${(a.ad_creative_bodies?.[0] ?? "").slice(0, 80)}`);
  if (!json.error && !json.data?.length) console.log("  (no results)");
}

console.log(`${process.env.META_AD_LIBRARY_TOKEN ? "META_AD_LIBRARY_TOKEN" : "system user token"}: ${token ? `${token.slice(0, 6)}… (${token.length} chars)` : "MISSING (META_SYSTEM_USER_TOKEN)"} · Graph ${v}`);
for (const c of [["IN"], ["FR", "DE", "IE"]]) {
  try { await adLibrary(c); } catch (err) { console.log(`\n■ Ad Library ${JSON.stringify(c)}: ${(err as Error).message}`); }
}

const res = await get(`${base}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.META_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: process.env.MODEL_WONDER ?? "muse-wonder-1.0",
    messages: [{ role: "user", content: `Search the ad library for competitors of a ${term} brand.` }],
    tools: [{ type: "function", function: { name: "search_ads", description: "Search Meta's Ad Library", parameters: { type: "object", properties: { terms: { type: "string" } }, required: ["terms"] } } }],
  }),
});
const json = (await res.json()) as { choices?: { message?: { tool_calls?: unknown; content?: string } }[]; error?: unknown };
console.log(`\n■ Muse Wonder tool calling: HTTP ${res.status}`);
console.log(JSON.stringify(json.choices?.[0]?.message ?? json.error ?? json).slice(0, 600));

// Search grounding (Muse Wonder's web search) and Reddit, used by the research agent for what customers say.
const { groundedSearch, searchReddit } = await import("@keel/meta");
try {
  const g = await groundedSearch(`${term} reviews complaints`);
  console.log(`\n■ Search grounding: OK · ${g.sources.length} sources\n  ${g.answer.slice(0, 200).replace(/\n/g, " ")}`);
  for (const s of g.sources.slice(0, 3)) console.log(`  · ${s.url}`);
} catch (err) { console.log(`\n■ Search grounding: ${(err as Error).message} (set META_SEARCH_TOOL if Meta names the tool differently)`); }
try {
  const r = await searchReddit(term, 3);
  console.log(`\n■ Reddit: ${r.length} threads`);
  for (const t of r) console.log(`  · r/${t.sub}: ${t.title.slice(0, 80)}`);
} catch (err) { console.log(`\n■ Reddit: ${(err as Error).message}`); }
export {};
