import { END, START, StateGraph, interrupt, isGraphBubbleUp, type BaseCheckpointSaver } from "@langchain/langgraph";
import { decide, type Approval, type BrandPolicy, type Finding } from "@keel/core";
import type { KeelDeps } from "./deps.ts";
import { diffFeatures } from "./drift.ts";
import { CycleState, type CycleStateT } from "./state.ts";
import { cycleContext, traceEvent } from "./trace.ts";

type Out = Partial<CycleStateT>;
type NodeFn = (s: CycleStateT) => Promise<Out>;

/**
 * The watch cycle: a fixed graph (reproducible, auditable) with model judgment only inside
 * `screen`, `inspect` and `investigate`, and a human approval interrupt before any action.
 */
export function buildCycleGraph(deps: KeelDeps, policy?: BrandPolicy, checkpointer?: BaseCheckpointSaver) {
  const threshold = deps.screenThreshold ?? 0.35;
  const [ambLo, ambHi] = deps.ambiguousBand ?? [0.45, 0.75];
  const findingsOf = (s: CycleStateT) => (s.resolved.length ? s.resolved : s.findings);
  const emit = async (...args: Parameters<typeof traceEvent>) => {
    const e = traceEvent(...args);
    if (e) await deps.emit?.(e);
  };

  /** Every node runs inside the cycle context and reports start/end to the live trace. */
  const traced = (node: string, fn: NodeFn, summary?: (u: Out) => Record<string, unknown>): NodeFn =>
    (s) => cycleContext.run({ cycleId: s.cycleId, accountId: s.accountId, node }, async () => {
      const t0 = Date.now();
      await emit("node_start", {}, node);
      try {
        const u = await fn(s);
        await emit("node_end", { ms: Date.now() - t0, ...(summary?.(u) ?? {}) }, node);
        return u;
      } catch (err) {
        // interrupt() pauses by throwing; that is not a failure.
        if (isGraphBubbleUp(err)) await emit("node_end", { ms: Date.now() - t0, paused: true }, node);
        else await emit("error", { message: String(err) }, node);
        throw err;
      }
    });

  const ingest: NodeFn = async (s) => {
    await emit("cycle_start", { accountId: s.accountId });
    const snapshots = await deps.snapshotAccount(s.accountId);
    await deps.recordSnapshots?.(s.cycleId, s.accountId, snapshots);
    await deps.audit("keel", "cycle.ingested", { cycleId: s.cycleId, ads: snapshots.length });
    return { snapshots };
  };

  const detectDrift: NodeFn = async (s) => {
    const findings: Finding[] = [];
    for (const snap of s.snapshots) {
      const baseline = await deps.getBaseline(snap.creativeId);
      findings.push(...diffFeatures(snap.adId, baseline, snap.featuresSpec, s.rulebook?.lockedEnhancements));
    }
    return { findings };
  };

  const screen: NodeFn = async (s) => {
    const screens = await Promise.all(
      s.snapshots.flatMap((snap) => snap.variants.map((v) => deps.screen(snap, v, s.rulebook))),
    );
    return { screens };
  };

  const inspect: NodeFn = async (s) => {
    const findings: Finding[] = [];
    for (const r of s.screens.filter((x) => x.score >= threshold)) {
      const snap = s.snapshots.find((x) => x.variants.some((v) => v.id === r.variantId));
      const variant = snap?.variants.find((v) => v.id === r.variantId);
      if (snap && variant) findings.push(...(await deps.inspect(snap, variant, r, s.rulebook)));
    }
    return { findings };
  };

  const investigate: NodeFn = async (s) => {
    if (!deps.investigate) return {};
    const resolved: Finding[] = [];
    for (const f of s.findings) {
      const ambiguous = f.detectedBy === "inspect" && f.confidence >= ambLo && f.confidence <= ambHi;
      const snap = s.snapshots.find((x) => x.adId === f.adId);
      resolved.push(ambiguous && snap ? await deps.investigate(f, snap, s.rulebook) : f);
    }
    return { resolved };
  };

  const decideNode: NodeFn = async (s) => {
    const findings = findingsOf(s);
    const proposals = decide(findings, s.rulebook, policy);
    await deps.recordDecisions?.(s.cycleId, s.accountId, findings, proposals);
    for (const f of findings) await emit("finding", { id: f.id, adId: f.adId, code: f.code, severity: f.severity, confidence: f.confidence, summary: f.summary });
    for (const p of proposals) await emit("proposal", { id: p.id, adId: p.adId, action: p.action, requiresApproval: p.requiresApproval });
    await deps.audit("keel", "cycle.decided", { cycleId: s.cycleId, proposals: proposals.map((p) => [p.adId, p.action]) });
    return { proposals };
  };

  // Separate from requestApproval: a node re-runs from the top when resumed, so side effects
  // placed before interrupt() would fire twice. Cards and pushes go out once, here.
  const notify: NodeFn = async (s) => {
    for (const p of s.proposals.filter((x) => x.requiresApproval)) {
      await deps.notify(p, findingsOf(s).filter((f) => p.findingIds.includes(f.id)), s.cycleId);
    }
    return {};
  };

  const requestApproval: NodeFn = async (s) => {
    const approvals: Approval[] = [];
    for (const p of s.proposals.filter((x) => x.requiresApproval)) {
      // Pauses the graph; the Keel Bridge decision endpoint resumes it.
      approvals.push(interrupt({ kind: "approval", proposal: p }) as Approval);
    }
    return { approvals };
  };

  const act: NodeFn = async (s) => {
    const executed: CycleStateT["executed"] = [];
    for (const a of s.approvals) {
      await deps.audit(a.decidedBy, `proposal.${a.decision}`, { proposalId: a.proposalId, channel: a.channel });
      await emit("decision", { proposalId: a.proposalId, decision: a.decision, by: a.decidedBy });
    }
    for (const p of s.proposals.filter((x) => x.action !== "LOG")) {
      const approval = s.approvals.find((a) => a.proposalId === p.id);
      if (p.requiresApproval && approval?.decision !== "approve" && approval?.decision !== "replace") continue;
      const result = await deps.execute(p, approval);
      executed.push({ proposalId: p.id, ...result });
      await emit("action", { proposalId: p.id, action: p.action, ...result });
    }
    return { executed };
  };

  const verify: NodeFn = async (s) => {
    const verified: CycleStateT["verified"] = [];
    for (const e of s.executed.filter((x) => x.ok)) {
      const p = s.proposals.find((x) => x.id === e.proposalId);
      const result = p && deps.verify ? await deps.verify(p) : { ok: true, detail: "no verifier configured" };
      verified.push({ proposalId: e.proposalId, ...result });
      await deps.audit("keel", result.ok ? "action.verified" : "action.verify_failed", { proposalId: e.proposalId, detail: result.detail });
    }
    return { verified };
  };

  const learn: NodeFn = async (s) => {
    await deps.recordFeedback?.(findingsOf(s), s.approvals);
    await deps.audit("keel", "cycle.completed", { cycleId: s.cycleId, findings: findingsOf(s).length, executed: s.executed.length });
    await emit("cycle_end", { findings: findingsOf(s).length, proposals: s.proposals.length, executed: s.executed.length });
    return {};
  };

  return new StateGraph(CycleState)
    .addNode("ingest", traced("ingest", ingest, (u) => ({ ads: u.snapshots?.length ?? 0 })))
    .addNode("detectDrift", traced("detectDrift", detectDrift, (u) => ({ findings: u.findings?.length ?? 0 })))
    .addNode("screen", traced("screen", screen, (u) => ({ variants: u.screens?.length ?? 0, flagged: u.screens?.filter((x) => x.score >= threshold).length ?? 0 })))
    .addNode("inspect", traced("inspect", inspect, (u) => ({ findings: u.findings?.length ?? 0 })))
    .addNode("investigate", traced("investigate", investigate))
    .addNode("decide", traced("decide", decideNode, (u) => ({ proposals: u.proposals?.length ?? 0 })))
    .addNode("notify", traced("notify", notify))
    .addNode("requestApproval", traced("requestApproval", requestApproval))
    .addNode("act", traced("act", act, (u) => ({ executed: u.executed?.length ?? 0 })))
    .addNode("verify", traced("verify", verify))
    .addNode("learn", traced("learn", learn))
    .addEdge(START, "ingest")
    .addEdge("ingest", "detectDrift")
    .addEdge("detectDrift", "screen")
    .addConditionalEdges("screen", (s) => (s.screens.some((x) => x.score >= threshold) ? "inspect" : "decide"), ["inspect", "decide"])
    .addEdge("inspect", "investigate")
    .addEdge("investigate", "decide")
    .addConditionalEdges("decide", (s) => (s.proposals.some((p) => p.requiresApproval) ? "notify" : "act"), ["notify", "act"])
    .addEdge("notify", "requestApproval")
    .addEdge("requestApproval", "act")
    .addEdge("act", "verify")
    .addEdge("verify", "learn")
    .addEdge("learn", END)
    .compile({ checkpointer });
}

/** Node order for the trace view. */
export const CYCLE_NODES = ["ingest", "detectDrift", "screen", "inspect", "investigate", "decide", "notify", "requestApproval", "act", "verify", "learn"] as const;
