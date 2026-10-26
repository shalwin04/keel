import { END, START, StateGraph, interrupt, type BaseCheckpointSaver } from "@langchain/langgraph";
import { decide, type Approval, type BrandPolicy, type Finding } from "@keel/core";
import type { KeelDeps } from "./deps.ts";
import { diffFeatures } from "./drift.ts";
import { CycleState, type CycleStateT, type CycleUpdate } from "./state.ts";

/**
 * The watch cycle: a fixed graph (reproducible, auditable) with model judgment only inside
 * `screen`, `inspect` and `investigate`, and a human approval interrupt before any action.
 */
export function buildCycleGraph(deps: KeelDeps, policy?: BrandPolicy, checkpointer?: BaseCheckpointSaver) {
  const threshold = deps.screenThreshold ?? 0.35;
  const [ambLo, ambHi] = deps.ambiguousBand ?? [0.45, 0.75];

  const ingest = async (s: CycleStateT): Promise<CycleUpdate> => {
    const snapshots = await deps.snapshotAccount(s.accountId);
    await deps.audit("keel", "cycle.ingested", { cycleId: s.cycleId, ads: snapshots.length });
    return { snapshots };
  };

  const detectDrift = async (s: CycleStateT): Promise<CycleUpdate> => {
    const findings: Finding[] = [];
    for (const snap of s.snapshots) {
      const baseline = await deps.getBaseline(snap.creativeId);
      findings.push(...diffFeatures(snap.adId, baseline, snap.featuresSpec, s.rulebook?.lockedEnhancements));
    }
    return { findings };
  };

  const screen = async (s: CycleStateT): Promise<CycleUpdate> => {
    const screens = await Promise.all(
      s.snapshots.flatMap((snap) => snap.variants.map((v) => deps.screen(snap, v, s.rulebook))),
    );
    return { screens };
  };

  const inspect = async (s: CycleStateT): Promise<CycleUpdate> => {
    const findings: Finding[] = [];
    for (const r of s.screens.filter((x) => x.score >= threshold)) {
      const snap = s.snapshots.find((x) => x.variants.some((v) => v.id === r.variantId));
      const variant = snap?.variants.find((v) => v.id === r.variantId);
      if (snap && variant) findings.push(...(await deps.inspect(snap, variant, r, s.rulebook)));
    }
    return { findings };
  };

  const investigate = async (s: CycleStateT): Promise<CycleUpdate> => {
    if (!deps.investigate) return {};
    const resolved: Finding[] = [];
    for (const f of s.findings) {
      const ambiguous = f.detectedBy === "inspect" && f.confidence >= ambLo && f.confidence <= ambHi;
      const snap = s.snapshots.find((x) => x.adId === f.adId);
      resolved.push(ambiguous && snap ? await deps.investigate(f, snap, s.rulebook) : f);
    }
    return { resolved };
  };

  const decideNode = async (s: CycleStateT): Promise<CycleUpdate> => {
    const findings = s.resolved.length ? s.resolved : s.findings;
    const proposals = decide(findings, s.rulebook, policy);
    await deps.audit("keel", "cycle.decided", { cycleId: s.cycleId, proposals: proposals.map((p) => [p.adId, p.action]) });
    return { proposals };
  };

  // Separate from requestApproval: a node re-runs from the top when resumed, so side effects
  // placed before interrupt() would fire twice. Cards go out once, here.
  const notify = async (s: CycleStateT): Promise<CycleUpdate> => {
    const pool = s.resolved.length ? s.resolved : s.findings;
    for (const p of s.proposals.filter((x) => x.requiresApproval)) {
      await deps.notify(p, pool.filter((f) => p.findingIds.includes(f.id)), s.cycleId);
    }
    return {};
  };

  const requestApproval = async (s: CycleStateT): Promise<CycleUpdate> => {
    const approvals: Approval[] = [];
    for (const p of s.proposals.filter((x) => x.requiresApproval)) {
      // Pauses the graph; the API resumes it with the owner's decision from WhatsApp or the dashboard.
      const decision = interrupt({ kind: "approval", proposal: p }) as Approval;
      approvals.push(decision);
    }
    return { approvals };
  };

  const act = async (s: CycleStateT): Promise<CycleUpdate> => {
    const executed: CycleStateT["executed"] = [];
    for (const a of s.approvals) await deps.audit(a.decidedBy, `proposal.${a.decision}`, { proposalId: a.proposalId, channel: a.channel });
    for (const p of s.proposals.filter((x) => x.action !== "LOG")) {
      const approval = s.approvals.find((a) => a.proposalId === p.id);
      if (p.requiresApproval && approval?.decision !== "approve" && approval?.decision !== "replace") continue;
      const result = await deps.execute(p, approval);
      executed.push({ proposalId: p.id, ...result });
      await deps.audit("keel", result.ok ? "action.verified" : "action.failed", { proposalId: p.id, detail: result.detail });
    }
    return { executed };
  };

  const learn = async (s: CycleStateT): Promise<CycleUpdate> => {
    await deps.recordFeedback?.(s.resolved.length ? s.resolved : s.findings, s.approvals);
    await deps.audit("keel", "cycle.completed", { cycleId: s.cycleId, findings: s.findings.length, executed: s.executed.length });
    return {};
  };

  return new StateGraph(CycleState)
    .addNode("ingest", ingest)
    .addNode("detectDrift", detectDrift)
    .addNode("screen", screen)
    .addNode("inspect", inspect)
    .addNode("investigate", investigate)
    .addNode("decide", decideNode)
    .addNode("notify", notify)
    .addNode("requestApproval", requestApproval)
    .addNode("act", act)
    .addNode("learn", learn)
    .addEdge(START, "ingest")
    .addEdge("ingest", "detectDrift")
    .addEdge("detectDrift", "screen")
    .addConditionalEdges("screen", (s) => (s.screens.some((x) => x.score >= threshold) ? "inspect" : "decide"), ["inspect", "decide"])
    .addEdge("inspect", "investigate")
    .addEdge("investigate", "decide")
    .addConditionalEdges("decide", (s) => (s.proposals.some((p) => p.requiresApproval) ? "notify" : "act"), ["notify", "act"])
    .addEdge("notify", "requestApproval")
    .addEdge("requestApproval", "act")
    .addEdge("act", "learn")
    .addEdge("learn", END)
    .compile({ checkpointer });
}
