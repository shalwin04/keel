import { randomUUID } from "node:crypto";
import type { FeaturesSpec, Finding } from "@keel/core";

const isOn = (v: string | undefined) => v === "OPT_IN" || v === "DEFAULT_OPT_IN";

/** Any enhancement that is on now but wasn't in the approved baseline (or is locked by the rulebook). */
export function diffFeatures(
  adId: string,
  baseline: FeaturesSpec | undefined,
  current: FeaturesSpec,
  locked: string[] = [],
): Finding[] {
  const out: Finding[] = [];
  for (const [name, now] of Object.entries(current)) {
    const was = baseline?.[name];
    const drifted = isOn(now) && (baseline ? !isOn(was) : false);
    const lockedOn = isOn(now) && locked.includes(name);
    if (!drifted && !lockedOn) continue;
    out.push({
      id: randomUUID(),
      adId,
      code: "SETTING_DRIFT",
      severity: lockedOn ? "high" : "medium",
      confidence: 1,
      summary: `${name} is ${now}${was ? ` (approved: ${was})` : ""}`,
      evidence: [`creative_features_spec.${name}`],
      regions: [],
      detectedBy: "drift",
    });
  }
  return out;
}
