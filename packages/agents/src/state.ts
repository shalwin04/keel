import { Annotation } from "@langchain/langgraph";
import type { AdSnapshot, Approval, Finding, Proposal, Rulebook, ScreenResult } from "@keel/core";

const append = <T>() => Annotation<T[]>({ reducer: (a, b) => a.concat(b), default: () => [] });
const replace = <T>(init: () => T) => Annotation<T>({ reducer: (_a, b) => b, default: init });

export const CycleState = Annotation.Root({
  cycleId: replace<string>(() => ""),
  accountId: replace<string>(() => ""),
  rulebook: replace<Rulebook | undefined>(() => undefined),
  snapshots: replace<AdSnapshot[]>(() => []),
  screens: append<ScreenResult>(),
  findings: append<Finding>(),
  /** findings after investigation (replaces, since `findings` only appends) */
  resolved: replace<Finding[]>(() => []),
  proposals: replace<Proposal[]>(() => []),
  approvals: append<Approval>(),
  executed: append<{ proposalId: string; ok: boolean; detail: string }>(),
  verified: append<{ proposalId: string; ok: boolean; detail: string }>(),
});

export type CycleStateT = typeof CycleState.State;
export type CycleUpdate = typeof CycleState.Update;
