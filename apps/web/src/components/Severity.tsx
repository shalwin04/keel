import type { Severity } from "../api.ts";
import { Pill } from "./ui.tsx";

const LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** Colour carries severity at a glance; the word says it for everyone. */
export const SeverityDot = ({ severity, className = "" }: { severity: Severity; className?: string }) => (
  <span aria-label={LABEL[severity]} className={`inline-block h-2 w-2 shrink-0 rounded-full bg-${severity} ${className}`} />
);

export const SeverityPill = ({ severity }: { severity: Severity }) => (
  <Pill tone={severity}><span className={`h-1.5 w-1.5 rounded-full bg-${severity}`} />{LABEL[severity]}</Pill>
);
