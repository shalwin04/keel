import type { AdSnapshot, Approval, FeaturesSpec, Finding, Proposal, Rulebook, ScreenResult, Variant } from "@keel/core";

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
  /** human */
  notify(proposal: Proposal, findings: Finding[], cycleId: string): Promise<void>;
  /** act + verify */
  execute(proposal: Proposal, approval?: Approval): Promise<{ ok: boolean; detail: string }>;
  /** learn */
  recordFeedback?(findings: Finding[], approvals: Approval[]): Promise<void>;
  audit(actor: string, event: string, payload: unknown): Promise<void>;
  /** tuning */
  screenThreshold?: number;
  ambiguousBand?: [number, number];
}
