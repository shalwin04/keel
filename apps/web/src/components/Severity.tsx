import { severityColor, type Severity } from "../api.ts";

/** A small filled pennant; its colour carries severity, the text label says it in words. */
export function SeverityMark({ severity, withLabel = false }: { severity: Severity; withLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
        <path d="M1 0v12M1 1h8l-2.5 3L9 7H1" fill={severityColor[severity]} stroke={severityColor[severity]} strokeWidth="1.2" />
      </svg>
      {withLabel && <span className="text-sm capitalize" style={{ color: severityColor[severity] }}>{severity}</span>}
    </span>
  );
}
