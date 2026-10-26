import { randomUUID } from "node:crypto";
import { DEFAULT_SEVERITY, severityRank, type Severity } from "./defects.ts";
import type { Action, Finding, Proposal, Rulebook } from "./schemas.ts";

export interface BrandPolicy {
  /** Actions Keel may take without asking. Spend- or creative-changing actions default to asking. */
  autoActions: Action[];
  /** Findings below this confidence are logged, never acted on. */
  minConfidence: number;
  approvalTtlHours: number;
}

export const DEFAULT_POLICY: BrandPolicy = {
  autoActions: ["LOG"],
  minConfidence: 0.6,
  approvalTtlHours: 6,
};

export function effectiveSeverity(f: Finding, rulebook?: Rulebook): Severity {
  return rulebook?.severityOverrides[f.code] ?? f.severity ?? DEFAULT_SEVERITY[f.code];
}

function actionFor(f: Finding, sev: Severity): Action {
  if (f.code === "SETTING_DRIFT") return "RELOCK_SETTING";
  if (severityRank(sev) >= severityRank("critical")) return "PAUSE_AD";
  if (severityRank(sev) >= severityRank("high")) return "REVERT_CREATIVE";
  return "LOG";
}

/**
 * Deterministic decision step: findings in, proposals out.
 * One proposal per ad, using the strongest action any of its findings calls for.
 */
export function decide(
  findings: Finding[],
  rulebook: Rulebook | undefined,
  policy: BrandPolicy = DEFAULT_POLICY,
  now: Date = new Date(),
): Proposal[] {
  const order: Action[] = ["LOG", "RELOCK_SETTING", "REVERT_CREATIVE", "REPLACE_CREATIVE", "PAUSE_AD"];
  const byAd = new Map<string, { action: Action; findings: Finding[] }>();

  for (const f of findings) {
    const action = f.confidence < policy.minConfidence ? "LOG" : actionFor(f, effectiveSeverity(f, rulebook));
    const cur = byAd.get(f.adId);
    if (!cur) byAd.set(f.adId, { action, findings: [f] });
    else {
      cur.findings.push(f);
      if (order.indexOf(action) > order.indexOf(cur.action)) cur.action = action;
    }
  }

  const expiresAt = new Date(now.getTime() + policy.approvalTtlHours * 3_600_000).toISOString();
  return [...byAd.entries()].map(([adId, { action, findings: fs }]) => ({
    id: randomUUID(),
    adId,
    action,
    findingIds: fs.map((f) => f.id),
    reason: fs.map((f) => `${f.code}: ${f.summary}`).join("; "),
    requiresApproval: !policy.autoActions.includes(action),
    expiresAt,
  }));
}
