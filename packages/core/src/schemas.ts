import { z } from "zod";
import { DEFECT_CODES, SEVERITIES } from "./defects.ts";

export const DefectCodeSchema = z.enum(DEFECT_CODES);
export const SeveritySchema = z.enum(SEVERITIES);

/** Normalised box in [0,1] image coordinates. */
export const RegionSchema = z.object({
  label: z.string(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  maskRef: z.string().optional(),
});
export type Region = z.infer<typeof RegionSchema>;

/** Enhancement name → OPT_IN / OPT_OUT, as read from creative_features_spec. */
export const FeaturesSpecSchema = z.record(z.string(), z.enum(["OPT_IN", "OPT_OUT", "DEFAULT_OPT_IN", "DEFAULT_OPT_OUT"]).or(z.string()));
export type FeaturesSpec = z.infer<typeof FeaturesSpecSchema>;

export const VariantSchema = z.object({
  id: z.string(),
  adId: z.string(),
  placement: z.string(),
  imageRef: z.string(),
  source: z.enum(["meta_preview", "fixture"]),
});
export type Variant = z.infer<typeof VariantSchema>;

export const AdSnapshotSchema = z.object({
  adId: z.string(),
  adName: z.string(),
  status: z.string(),
  creativeId: z.string(),
  originalImageRef: z.string().optional(),
  primaryText: z.string().optional(),
  featuresSpec: FeaturesSpecSchema,
  variants: z.array(VariantSchema),
});
export type AdSnapshot = z.infer<typeof AdSnapshotSchema>;

export const RulebookSchema = z.object({
  brand: z.string(),
  version: z.number().int(),
  audience: z.object({
    description: z.string(),
    casting: z.array(z.string()).describe("Who may appear, e.g. 'men 30-45'"),
  }),
  palette: z.array(z.string()).default([]),
  tone: z.string().default(""),
  banned: z.array(z.string()).default([]),
  claimLimits: z.array(z.string()).default([]),
  productTruths: z
    .array(z.object({ product: z.string(), facts: z.array(z.string()) }))
    .default([]),
  lockedEnhancements: z
    .array(z.string())
    .default([])
    .describe("Enhancements that must stay OPT_OUT"),
  severityOverrides: z.partialRecord(DefectCodeSchema, SeveritySchema).default({}),
});
export type Rulebook = z.infer<typeof RulebookSchema>;

export const ScreenResultSchema = z.object({
  variantId: z.string(),
  score: z.number().min(0).max(1).describe("0 = identical in meaning, 1 = clearly off-brand"),
  suspected: z.array(DefectCodeSchema),
  note: z.string(),
});
export type ScreenResult = z.infer<typeof ScreenResultSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  adId: z.string(),
  variantId: z.string().optional(),
  code: DefectCodeSchema,
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  evidence: z.array(z.string()),
  regions: z.array(RegionSchema).default([]),
  detectedBy: z.enum(["drift", "screen", "inspect", "investigate", "shield"]),
  /** Image refs for the review card: approved original and the served variant. */
  originalRef: z.string().optional(),
  variantRef: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ACTIONS = ["LOG", "RELOCK_SETTING", "PAUSE_AD", "REVERT_CREATIVE", "REPLACE_CREATIVE"] as const;
export const ActionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof ActionSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  findingIds: z.array(z.string()),
  adId: z.string(),
  action: ActionSchema,
  reason: z.string(),
  requiresApproval: z.boolean(),
  expiresAt: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const ApprovalSchema = z.object({
  proposalId: z.string(),
  decision: z.enum(["approve", "reject", "replace"]),
  /** Keel Bridge user id. */
  decidedBy: z.string(),
  channel: z.enum(["web", "voice"]),
  transcript: z.string().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

/** Live events for the trace view and the review queue (sent over SSE). */
export const TRACE_KINDS = ["cycle_start", "node_start", "node_end", "model_call", "finding", "proposal", "decision", "action", "cycle_end", "error"] as const;
export const TraceEventSchema = z.object({
  cycleId: z.string(),
  kind: z.enum(TRACE_KINDS),
  node: z.string().optional(),
  at: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type TraceKind = (typeof TRACE_KINDS)[number];
