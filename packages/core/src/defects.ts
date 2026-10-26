/** What "off-brand" means, concretely. See docs/IDEATION.md §3. */
export const DEFECT_CODES = [
  "PERSON_MISMATCH",
  "ANATOMY",
  "PRODUCT_DRIFT",
  "TEXT_ERROR",
  "CLAIM",
  "SCENE_MISMATCH",
  "BRAND_RULE",
  "POLICY_RISK",
  "SETTING_DRIFT",
] as const;

export type DefectCode = (typeof DEFECT_CODES)[number];

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Default severity per defect; a brand's rulebook can raise or lower these. */
export const DEFAULT_SEVERITY: Record<DefectCode, Severity> = {
  PERSON_MISMATCH: "high",
  ANATOMY: "critical",
  PRODUCT_DRIFT: "critical",
  TEXT_ERROR: "high",
  CLAIM: "critical",
  SCENE_MISMATCH: "medium",
  BRAND_RULE: "high",
  POLICY_RISK: "high",
  SETTING_DRIFT: "medium",
};

export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s);
