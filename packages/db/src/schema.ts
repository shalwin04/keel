import { bigserial, boolean, integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

export const brands = pgTable("brands", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  whatsappNumber: text("whatsapp_number"),
  policy: jsonb("policy").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const adAccounts = pgTable("ad_accounts", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  metaAccountId: text("meta_account_id").notNull(),
  tokenRef: text("token_ref").notNull(),
  pollIntervalMin: integer("poll_interval_min").default(180).notNull(),
});

export const rulebooks = pgTable("rulebooks", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  version: integer("version").notNull(),
  rules: jsonb("rules").notNull(),
  sourceAds: jsonb("source_ads").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const creativeBaselines = pgTable("creative_baselines", {
  creativeId: text("creative_id").primaryKey(),
  adId: text("ad_id").notNull(),
  approvedImageHash: text("approved_image_hash"),
  featuresSpec: jsonb("features_spec").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
  lockedBy: text("locked_by").notNull(),
});

export const snapshots = pgTable("snapshots", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull(),
  adId: text("ad_id").notNull(),
  creativeId: text("creative_id").notNull(),
  featuresSpec: jsonb("features_spec").notNull(),
  variants: jsonb("variants").notNull(),
  takenAt: timestamp("taken_at", { withTimezone: true }).defaultNow().notNull(),
});

export const findings = pgTable("findings", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull(),
  adId: text("ad_id").notNull(),
  variantId: text("variant_id"),
  code: text("code").notNull(),
  severity: text("severity").notNull(),
  confidence: real("confidence").notNull(),
  summary: text("summary").notNull(),
  evidence: jsonb("evidence").notNull(),
  regions: jsonb("regions").notNull(),
  detectedBy: text("detected_by").notNull(),
  status: text("status").default("open").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const proposals = pgTable("proposals", {
  id: text("id").primaryKey(),
  adId: text("ad_id").notNull(),
  findingIds: jsonb("finding_ids").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  requiresApproval: boolean("requires_approval").notNull(),
  status: text("status").default("pending").notNull(),
  threadId: text("thread_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  proposalId: text("proposal_id").notNull().references(() => proposals.id),
  channel: text("channel").notNull(),
  decidedBy: text("decided_by").notNull(),
  decision: text("decision").notNull(),
  raw: jsonb("raw"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLog = pgTable("audit_log", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
