import type { AdSnapshot, Approval, BrandPolicy, FeaturesSpec, Finding, Proposal, Rulebook, ScreenResult, Variant } from "@keel/core";
import type { Emit } from "./trace.ts";

export interface ActionResult { ok: boolean; detail: string; data?: Record<string, unknown> }
export interface ActionContext { snapshot?: AdSnapshot; findings: Finding[]; rulebook?: Rulebook }
export interface Outcome { proposalId: string; executed?: ActionResult; verified?: ActionResult }

/**
 * Everything the cycle touches outside itself. Injected so the graph runs against
 * real Meta APIs in production and against fakes in tests and the eval harness.
 */
export interface KeelDeps {
  /** ingest */
  snapshotAccount(accountId: string): Promise<AdSnapshot[]>;
  /** The brand's rulebook and policy for this account. */
  loadBrand?(accountId: string): Promise<{ rulebook?: Rulebook; policy?: Partial<BrandPolicy> } | undefined>;
  /** Locked settings for an ad. Keyed by ad, not creative: editing an ad in Ads Manager creates a new creative id. */
  getBaseline(creativeId: string, adId: string): Promise<FeaturesSpec | undefined>;
  /** judge */
  screen(snapshot: AdSnapshot, variant: Variant, rulebook?: Rulebook): Promise<ScreenResult>;
  inspect(snapshot: AdSnapshot, variant: Variant, screen: ScreenResult, rulebook?: Rulebook): Promise<Finding[]>;
  investigate?(finding: Finding, snapshot: AdSnapshot, rulebook?: Rulebook): Promise<Finding>;
  /** Drops findings a person already dismissed (Keel doesn't re-ask the same question). */
  filterFindings?(accountId: string, findings: Finding[]): Promise<Finding[]>;
  /** persistence (optional so tests stay light) */
  recordSnapshots?(cycleId: string, accountId: string, snapshots: AdSnapshot[]): Promise<void>;
  recordDecisions?(cycleId: string, accountId: string, findings: Finding[], proposals: Proposal[]): Promise<void>;
  /** human: put the card in the Keel Bridge review queue and push-notify reviewers */
  notify(proposal: Proposal, findings: Finding[], cycleId: string): Promise<void>;
  /** act + verify */
  execute(proposal: Proposal, approval: Approval | undefined, ctx: ActionContext): Promise<ActionResult>;
  verify?(proposal: Proposal, executed: ActionResult): Promise<ActionResult>;
  /** learn */
  recordFeedback?(o: { findings: Finding[]; proposals: Proposal[]; approvals: Approval[]; outcomes: Outcome[]; snapshots: AdSnapshot[] }): Promise<void>;
  audit(actor: string, event: string, payload: unknown): Promise<void>;
  /** live trace for the Keel Bridge trace view */
  emit?: Emit;
  /** tuning */
  screenThreshold?: number;
  ambiguousBand?: [number, number];
}
