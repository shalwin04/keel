import type { AdSnapshot, Approval, FeaturesSpec, Finding, Proposal, Rulebook, ScreenResult, Variant } from "@keel/core";
import type { Emit } from "./trace.ts";

export interface ActionResult { ok: boolean; detail: string }

/**
 * Everything the cycle touches outside itself. Injected so the graph runs against
 * real Meta APIs in production and against fakes in tests and the eval harness.
 */
export interface KeelDeps {
  /** ingest */
  snapshotAccount(accountId: string): Promise<AdSnapshot[]>;
  getBaseline(creativeId: string): Promise<FeaturesSpec | undefined>;
  /** judge */
  screen(snapshot: AdSnapshot, variant: Variant, rulebook?: Rulebook): Promise<ScreenResult>;
  inspect(snapshot: AdSnapshot, variant: Variant, screen: ScreenResult, rulebook?: Rulebook): Promise<Finding[]>;
  investigate?(finding: Finding, snapshot: AdSnapshot, rulebook?: Rulebook): Promise<Finding>;
  /** persistence (optional so tests stay light) */
  recordSnapshots?(cycleId: string, accountId: string, snapshots: AdSnapshot[]): Promise<void>;
  recordDecisions?(cycleId: string, accountId: string, findings: Finding[], proposals: Proposal[]): Promise<void>;
  /** human: put the card in the Keel Bridge review queue and push-notify reviewers */
  notify(proposal: Proposal, findings: Finding[], cycleId: string): Promise<void>;
  /** act + verify */
  execute(proposal: Proposal, approval?: Approval): Promise<ActionResult>;
  verify?(proposal: Proposal): Promise<ActionResult>;
  /** learn */
  recordFeedback?(findings: Finding[], approvals: Approval[]): Promise<void>;
  audit(actor: string, event: string, payload: unknown): Promise<void>;
  /** live trace for the Keel Bridge trace view */
  emit?: Emit;
  /** tuning */
  screenThreshold?: number;
  ambiguousBand?: [number, number];
}
