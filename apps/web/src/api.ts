import type { Brief, DesignDoc, Direction } from "@keel/core/studio";
export type Severity = "critical" | "high" | "medium" | "low";
export type Role = "owner" | "reviewer" | "viewer";

export interface Region { label: string; box: [number, number, number, number] }
export interface FindingRow {
  id: string; adId: string; accountId: string; code: string; severity: Severity; confidence: number;
  summary: string; evidence: string[]; regions: Region[]; detectedBy: string;
  originalRef: string | null; variantRef: string | null; status: string; createdAt: string;
}
export interface ActionOutcome { ok: boolean; detail: string }
export interface QueueItem {
  id: string; cycleId: string; accountId: string; accountName: string; adId: string; adName: string; action: string; reason: string;
  status: string; expiresAt: string; createdAt: string; findings: FindingRow[];
  outcome: { executed?: ActionOutcome; verified?: ActionOutcome } | null;
  decision: { decision: string; decidedAt: string; name: string } | null;
}
export interface Account {
  metaAccountId: string; name: string; role: Role; brandId: string; workspaceId: string; isDemo: boolean;
  watching: boolean; pollIntervalMin: number; ads: number;
  openBySeverity: Partial<Record<Severity, number>>;
  lastCycle: Cycle | null;
}
export interface AdRow {
  adId: string; adName: string; status: string; creativeId: string; originalRef: string | null;
  featuresSpec: Record<string, string>; baseline: Record<string, string> | null; baselineLockedAt: string | null; baselineLockedBy: string | null;
  variants: number; openFindings: Severity[]; takenAt: string; changedByKeel?: boolean;
}
export interface TraceRow { seq: number; cycleId: string; kind: string; node: string | null; at: string; data: Record<string, unknown> }
export interface Cycle { id: string; accountId: string; status: string; startedAt: string; endedAt: string | null; error: string | null }
export interface AuditEntry { seq: number; at: string; actor: string; actorName: string; event: string; payload: unknown; hash: string }
export interface Me {
  user: { id: string; name: string }; accounts: Account[];
  workspaces: { id: string; name: string; isDemo: boolean; role: Role }[];
  metaConnected: boolean; metaExpiresAt: string | null;
}
export interface Overview { pending: number; openFindings: number; actions7d: number; cycles24h: number; ads: number; costUsd7d: number; lastCycle: Cycle | null }
export interface Policy { autoActions: string[]; minConfidence: number; approvalTtlHours: number }
export interface Rulebook {
  brand: string; version: number;
  audience: { description: string; casting: string[] };
  palette: string[]; tone: string; banned: string[]; claimLimits: string[];
  productTruths: { product: string; facts: string[] }[];
  lockedEnhancements: string[]; severityOverrides: Partial<Record<string, Severity>>;
}
export interface Brand {
  id: string; name: string; role: Role; isDemo: boolean; accounts: { metaAccountId: string; name: string }[];
  policy: Policy; rulebook: { version: number; rules: Rulebook; createdAt: string } | null; learned: number;
}
export interface Member { workspaceId: string; workspace: string; isDemo: boolean; userId: string; name: string; email: string | null; role: Role }
export interface AuthOptions { facebook: boolean; demo: boolean; dev: boolean }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/auth/") && location.pathname !== "/login") location.assign("/login");
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  me: () => request<Me>("/api/me"),
  authOptions: () => request<AuthOptions>("/auth/options"),
  overview: () => request<Overview>("/api/overview"),
  brands: () => request<Brand[]>("/api/brands"),
  saveRulebook: (brandId: string, r: Omit<Rulebook, "brand" | "version">) => request<Rulebook>(`/api/brands/${brandId}/rulebook`, { method: "PUT", body: JSON.stringify(r) }),
  savePolicy: (brandId: string, p: Partial<Policy>) => request<Policy>(`/api/brands/${brandId}/policy`, { method: "PUT", body: JSON.stringify(p) }),
  patchAccount: (id: string, b: { watching?: boolean; pollIntervalMin?: number }) => request(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  members: () => request<Member[]>("/api/workspace/members"),
  queue: (status = "pending") => request<QueueItem[]>(`/api/queue?status=${status}`),
  decide: (id: string, decision: "approve" | "reject" | "replace") =>
    request<{ ok: true; cycleId: string }>(`/api/proposals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) }),
  accounts: () => request<Account[]>("/api/accounts"),
  ads: (accountId: string) => request<AdRow[]>(`/api/accounts/${accountId}/ads`),
  runCycle: (accountId: string) => request<{ cycleId: string }>(`/api/accounts/${accountId}/cycles`, { method: "POST" }),
  cycles: () => request<Cycle[]>("/api/cycles"),
  trace: (cycleId: string) => request<{ cycle: Cycle; events: TraceRow[] }>(`/api/cycles/${cycleId}/trace`),
  audit: () => request<{ verified: boolean; total: number; brokenAt: number | null; entries: AuditEntry[] }>("/api/audit"),
  metaAdAccounts: () => request<{ data?: { id: string; name: string; account_status: number; connected: boolean }[] }>("/api/meta/adaccounts"),
  addAccount: (b: { metaAccountId: string; name: string; brandName: string }) =>
    request<{ brandId: string }>("/api/accounts", { method: "POST", body: JSON.stringify(b) }),
  draftRulebook: (b: { brandId: string; adImageUrls: string[]; guidelines?: string }) =>
    request<Record<string, unknown>>("/api/rulebooks/draft", { method: "POST", body: JSON.stringify(b) }),
  demoLogin: () => request<{ ok: true }>("/auth/demo", { method: "POST" }),
  devLogin: () => request<{ ok: true }>("/auth/dev", { method: "POST" }),
  resetDemo: () => request<{ proposals: number }>("/api/demo/reset", { method: "POST" }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  pushKey: () => request<{ publicKey: string | null }>("/api/push/key"),
  pushSubscribe: (s: PushSubscriptionJSON) => request("/api/push/subscribe", { method: "POST", body: JSON.stringify(s) }),
};

export const mediaUrl = (ref: string | null) => (ref ? `/api/media?ref=${encodeURIComponent(ref)}` : undefined);

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
export const severityColor: Record<Severity, string> = { critical: "var(--critical)", high: "var(--high)", medium: "var(--medium)", low: "var(--low)" };

/** Plain-language names for defect codes and actions. */
export const CODE_LABEL: Record<string, string> = {
  PERSON_MISMATCH: "Wrong person", ANATOMY: "Distorted body", PRODUCT_DRIFT: "Product changed", TEXT_ERROR: "Text error",
  CLAIM: "Unapproved claim", SCENE_MISMATCH: "Wrong scene", BRAND_RULE: "Breaks a brand rule", POLICY_RISK: "Policy risk",
  SETTING_DRIFT: "AI setting switched on",
};

/** Plain names for Advantage+ creative enhancements. Unknown ones are humanised from their key. */
export const FEATURE_LABEL: Record<string, string> = {
  image_touchups: "Visual touch-ups", image_templates: "Image templates", image_uncrop: "Image expansion", image_brightness_and_contrast: "Brightness & contrast",
  image_background_gen: "Generated backgrounds", text_optimizations: "Text improvements", text_generation: "Generated text", inline_comment: "Relevant comments",
  enhance_cta: "Enhanced CTA", music: "Music", video_auto_crop: "Video auto-crop", add_text_overlay: "Text overlay", description_automation: "Dynamic description",
  image_animation: "Image animation", adapt_to_placement: "Adapt to placement", standard_enhancements: "Standard enhancements", site_extensions: "Site links",
  product_extensions: "Catalog items", pac_recomposition: "Placement recomposition", image_auto_crop: "Auto-crop", text_translation: "Translation",
  carousel_to_video: "Carousel to video", creative_stickers: "Stickers", site_extension: "Site links", local_store_extension: "Store locations",
  image_enhancement: "Image enhancement", video_filtering: "Video filters", add_stickers: "Stickers", advantage_plus_creative: "Advantage+ creative", show_summary: "Summary", reveal_details_over_time: "Reveal details", hide_price: "Hide price",
};
export const featureLabel = (k: string) => FEATURE_LABEL[k] ?? k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const isOn = (v?: string | null) => v === "OPT_IN" || v === "DEFAULT_OPT_IN";
export const ACTION_LABEL: Record<string, string> = {
  PAUSE_AD: "Pause the ad", REVERT_CREATIVE: "Restore the approved creative", RELOCK_SETTING: "Switch it back off",
  REPLACE_CREATIVE: "Replace with an on-brand version", LOG: "Log only",
};

// ── Studio ───────────────────────────────────────────────────────────────────
export type { Brief, DesignDoc, Direction };
export interface StudioStep { key: string; label: string; status: "waiting" | "running" | "done" | "failed"; detail?: string; ms?: number }
export type StudioDirection = Direction & { sceneRef: string; sceneHistory?: string[]; productInScene?: boolean };
export interface StudioDesign { id: string; projectId: string; direction: number; size: "square" | "portrait" | "story"; doc: DesignDoc; renderRef: string | null; check: { pass: boolean; score: number; issues: string[] } | null; picked: boolean; updatedAt: string }
export interface StudioProject {
  id: string; name: string; accountId: string; brandId: string; status: "drafting" | "ready" | "launching" | "launched" | "failed";
  brief: Brief; steps: StudioStep[]; directions: StudioDirection[] | null; error: string | null; createdAt: string; updatedAt: string;
  launch: { campaignId: string; adsetId: string; ads: { designId: string; direction: number; adId: string }[]; at: string } | null;
}
export interface StudioProjectDetail extends StudioProject { role: Role; designs: StudioDesign[] }

async function upload(file: File): Promise<{ ref: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/studio/uploads", { method: "POST", body: fd, credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? "Upload failed");
  return body as { ref: string };
}

export const studio = {
  upload,
  projects: () => request<(StudioProject & { covers: (string | null)[] })[]>("/api/studio/projects"),
  project: (id: string) => request<StudioProjectDetail>(`/api/studio/projects/${id}`),
  create: (b: { accountId: string; name: string; brief: Brief }) => request<{ id: string }>("/api/studio/projects", { method: "POST", body: JSON.stringify(b) }),
  saveDesign: (id: string, b: { doc?: DesignDoc; picked?: boolean }) => request<{ ok: true; renderRef: string }>(`/api/studio/designs/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  newScene: (id: string, n: number) => request<{ sceneRef: string }>(`/api/studio/projects/${id}/directions/${n}/scene`, { method: "POST" }),
  useScene: (id: string, n: number, ref: string) => request(`/api/studio/projects/${id}/directions/${n}/use-scene`, { method: "POST", body: JSON.stringify({ ref }) }),
  template: (id: string, n: number, template: string) => request(`/api/studio/projects/${id}/directions/${n}/template`, { method: "POST", body: JSON.stringify({ template }) }),
  retry: (id: string) => request(`/api/studio/projects/${id}/retry`, { method: "POST" }),
  launch: (id: string) => request<NonNullable<StudioProject["launch"]>>(`/api/studio/projects/${id}/launch`, { method: "POST" }),
  downloadUrl: (designId: string) => `/api/studio/designs/${designId}/download`,
};
export const adsManagerUrl = (accountId: string, campaignId?: string) =>
  `https://adsmanager.facebook.com/adsmanager/manage/${campaignId ? "adsets" : "campaigns"}?act=${accountId.replace("act_", "")}${campaignId ? `&selected_campaign_ids=${campaignId}` : ""}`;
