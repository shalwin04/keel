export type Severity = "critical" | "high" | "medium" | "low";
export type Role = "owner" | "reviewer" | "viewer";

export interface Region { label: string; box: [number, number, number, number] }
export interface FindingRow {
  id: string; adId: string; accountId: string; code: string; severity: Severity; confidence: number;
  summary: string; evidence: string[]; regions: Region[]; detectedBy: string;
  originalRef: string | null; variantRef: string | null; status: string; createdAt: string;
}
export interface QueueItem {
  id: string; cycleId: string; accountId: string; adId: string; adName: string; action: string; reason: string;
  status: string; expiresAt: string; createdAt: string; findings: FindingRow[];
}
export interface Account {
  metaAccountId: string; name: string; role: Role; brandId: string; workspaceId: string; isDemo: boolean;
  openBySeverity: Partial<Record<Severity, number>>;
  lastCycle: { id: string; status: string; startedAt: string } | null;
}
export interface AdRow {
  adId: string; adName: string; status: string; creativeId: string; originalRef: string | null;
  featuresSpec: Record<string, string>; baseline: Record<string, string> | null; openFindings: Severity[]; takenAt: string;
}
export interface TraceRow { seq: number; cycleId: string; kind: string; node: string | null; at: string; data: Record<string, unknown> }
export interface Cycle { id: string; accountId: string; status: string; startedAt: string; endedAt: string | null }
export interface AuditEntry { seq: number; at: string; actor: string; actorName: string; event: string; payload: unknown; hash: string }
export interface Me { user: { id: string; name: string }; accounts: Account[] }

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
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  me: () => request<Me>("/api/me"),
  queue: (status = "pending") => request<QueueItem[]>(`/api/queue?status=${status}`),
  decide: (id: string, decision: "approve" | "reject" | "replace") =>
    request<{ ok: true; cycleId: string }>(`/api/proposals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) }),
  accounts: () => request<Account[]>("/api/accounts"),
  ads: (accountId: string) => request<AdRow[]>(`/api/accounts/${accountId}/ads`),
  runCycle: (accountId: string) => request<{ cycleId: string }>(`/api/accounts/${accountId}/cycles`, { method: "POST" }),
  cycles: () => request<Cycle[]>("/api/cycles"),
  trace: (cycleId: string) => request<{ cycle: Cycle; events: TraceRow[] }>(`/api/cycles/${cycleId}/trace`),
  audit: () => request<{ verified: boolean; brokenAt: number | null; entries: AuditEntry[] }>("/api/audit"),
  metaAdAccounts: () => request<{ data?: { id: string; name: string }[] }>("/api/meta/adaccounts"),
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
export const severityColor: Record<Severity, string> = {
  critical: "var(--color-port)", high: "var(--color-ember)", medium: "var(--color-ochre)", low: "var(--color-fog)",
};

/** Plain-language names for defect codes and actions. */
export const CODE_LABEL: Record<string, string> = {
  PERSON_MISMATCH: "Wrong person", ANATOMY: "Distorted body", PRODUCT_DRIFT: "Product changed", TEXT_ERROR: "Text error",
  CLAIM: "Unapproved claim", SCENE_MISMATCH: "Wrong scene", BRAND_RULE: "Breaks a brand rule", POLICY_RISK: "Policy risk",
  SETTING_DRIFT: "Setting switched on",
};
export const ACTION_LABEL: Record<string, string> = {
  PAUSE_AD: "Pause the ad", REVERT_CREATIVE: "Revert to the approved creative", RELOCK_SETTING: "Switch the setting back off",
  REPLACE_CREATIVE: "Replace with an on-brand version", LOG: "Log only",
};
