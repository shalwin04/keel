import { bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ── People and access ────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  metaUserId: text("meta_user_id").unique(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

/** A brand's own team or an agency. */
export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isDemo: boolean("is_demo").default(false).notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const memberships = pgTable("memberships", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role").notNull(), // owner | reviewer | viewer
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

/** Meta access from Facebook Login for Business. Token is AES-GCM encrypted at rest. */
export const metaConnections = pgTable("meta_connections", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  userId: text("user_id").notNull().references(() => users.id),
  tokenEnc: text("token_enc").notNull(),
  scopes: jsonb("scopes").notNull(),
  expiresAt: ts("expires_at"),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  keys: jsonb("keys").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

// ── Brands and accounts ──────────────────────────────────────────────────────

export const brands = pgTable("brands", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  policy: jsonb("policy").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const adAccounts = pgTable("ad_accounts", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  metaAccountId: text("meta_account_id").notNull().unique(),
  name: text("name").notNull(),
  connectionId: text("connection_id"),
  pollIntervalMin: integer("poll_interval_min").default(180).notNull(),
  /** Off = Keel stops watching this account (data is kept). */
  watching: boolean("watching").default(true).notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const rulebooks = pgTable("rulebooks", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  version: integer("version").notNull(),
  rules: jsonb("rules").notNull(),
  sourceAds: jsonb("source_ads").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

// ── The watch cycle ──────────────────────────────────────────────────────────

export const creativeBaselines = pgTable("creative_baselines", {
  creativeId: text("creative_id").primaryKey(),
  adId: text("ad_id").notNull(),
  approvedImageHash: text("approved_image_hash"),
  featuresSpec: jsonb("features_spec").notNull(),
  lockedAt: ts("locked_at").defaultNow().notNull(),
  lockedBy: text("locked_by").notNull(),
});

export const cycles = pgTable("cycles", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  status: text("status").notNull(), // running | awaiting_approval | completed | failed | expired
  startedAt: ts("started_at").defaultNow().notNull(),
  endedAt: ts("ended_at"),
  error: text("error"),
}, (t) => [index("cycles_account_idx").on(t.accountId, t.startedAt)]);

export const snapshots = pgTable("snapshots", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull(),
  accountId: text("account_id").notNull(),
  adId: text("ad_id").notNull(),
  adName: text("ad_name").notNull(),
  status: text("status").notNull(),
  creativeId: text("creative_id").notNull(),
  originalRef: text("original_ref"),
  featuresSpec: jsonb("features_spec").notNull(),
  variants: jsonb("variants").notNull(),
  takenAt: ts("taken_at").defaultNow().notNull(),
}, (t) => [index("snapshots_account_idx").on(t.accountId, t.takenAt), index("snapshots_ad_idx").on(t.adId)]);

export const findings = pgTable("findings", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull(),
  accountId: text("account_id").notNull(),
  adId: text("ad_id").notNull(),
  variantId: text("variant_id"),
  code: text("code").notNull(),
  severity: text("severity").notNull(),
  confidence: real("confidence").notNull(),
  summary: text("summary").notNull(),
  evidence: jsonb("evidence").notNull(),
  regions: jsonb("regions").notNull(),
  detectedBy: text("detected_by").notNull(),
  originalRef: text("original_ref"),
  variantRef: text("variant_ref"),
  status: text("status").default("open").notNull(), // open | resolved | dismissed | logged
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [index("findings_account_idx").on(t.accountId, t.status), index("findings_ad_idx").on(t.adId)]);

export const proposals = pgTable("proposals", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull(),
  accountId: text("account_id").notNull(),
  adId: text("ad_id").notNull(),
  findingIds: jsonb("finding_ids").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  requiresApproval: boolean("requires_approval").notNull(),
  status: text("status").default("pending").notNull(), // pending | deciding | approved | rejected | expired | stale | executed | failed | logged
  /** What happened when the approved action ran: { executed, verified }. */
  outcome: jsonb("outcome"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [index("proposals_account_idx").on(t.accountId, t.status), index("proposals_cycle_idx").on(t.cycleId)]);

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  proposalId: text("proposal_id").notNull().references(() => proposals.id),
  channel: text("channel").notNull(), // web | voice
  decidedBy: text("decided_by").notNull().references(() => users.id),
  decision: text("decision").notNull(),
  transcript: text("transcript"),
  decidedAt: ts("decided_at").defaultNow().notNull(),
});

/** Every step of every cycle, for the live trace view. */
export const traceEvents = pgTable("trace_events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  cycleId: text("cycle_id").notNull(),
  kind: text("kind").notNull(),
  node: text("node"),
  at: ts("at").notNull(),
  data: jsonb("data").notNull(),
}, (t) => [index("trace_cycle_idx").on(t.cycleId, t.seq)]);

export const auditLog = pgTable("audit_log", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  at: ts("at").defaultNow().notNull(),
  actor: text("actor").notNull(),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});

export const evalRuns = pgTable("eval_runs", {
  id: text("id").primaryKey(),
  modelTier: text("model_tier").notNull(),
  precision: real("precision").notNull(),
  recall: real("recall").notNull(),
  costPerVariantUsd: real("cost_per_variant_usd"),
  createdAt: ts("created_at").defaultNow().notNull(),
});
