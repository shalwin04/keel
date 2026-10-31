import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type AuditEntry } from "../api.ts";
import { IconShield } from "../components/Icons.tsx";
import { Card, Empty, ErrorNote, Input, PageHeader, Pill, Skeleton, relTime } from "../components/ui.tsx";

const EVENT: Record<string, string> = {
  "cycle.ingested": "Checked the account", "cycle.decided": "Decided what to propose", "cycle.completed": "Finished a check", "cycle.error": "A check failed",
  "proposal.approve": "Approved a change", "proposal.reject": "Kept an ad running", "proposal.replace": "Asked for a replacement", "proposal.expired": "A request expired",
  "action.executed": "Changed the ad", "action.failed": "A change failed", "action.verified": "Confirmed the change with Meta", "action.verify_failed": "Couldn't confirm the change",
  "account.connected": "Connected an ad account", "account.claimed": "Moved an ad account into this workspace", "account.updated": "Changed account settings", "rulebook.updated": "Edited the rulebook", "rulebook.drafted": "Drafted the rulebook",
  "policy.updated": "Changed approval rules",
};

const detail = (e: AuditEntry) => {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const bits = [p.detail, p.metaAccountId, p.adId && `ad ${p.adId}`, typeof p.ads === "number" && `${p.ads} ads`, p.version && `v${p.version}`, p.simulated && "simulated"].filter(Boolean);
  return bits.join(" · ");
};

export function Audit() {
  const q = useQuery({ queryKey: ["audit"], queryFn: api.audit });
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => (q.data?.entries ?? []).filter((e) => !filter || `${e.actorName} ${EVENT[e.event] ?? e.event} ${detail(e)}`.toLowerCase().includes(filter.toLowerCase())), [q.data, filter]);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every decision and every change, in a tamper-evident chain."
        actions={q.data && (q.data.verified
          ? <Pill tone="ok"><IconShield size={13} /> Chain intact · {q.data.total} entries</Pill>
          : <Pill tone="critical">Chain broken at #{q.data.brokenAt}</Pill>)} />
      <div className="mb-4 max-w-sm"><Input type="search" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      {q.isLoading ? <Skeleton className="h-96" /> : q.isError ? <ErrorNote error={q.error} /> : !rows.length ? (
        <Card><Empty icon={<IconShield size={26} />} title={filter ? "Nothing matches" : "Nothing logged yet"} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--line)]">
            {rows.map((e) => (
              <li key={e.seq} className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-3 md:grid-cols-[160px_1fr_auto]">
                <span className="text-[13px] text-ink-2 md:pt-0.5">{e.actorName}</span>
                <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
                  <span className="block text-[14px] font-medium">{EVENT[e.event] ?? e.event}</span>
                  {detail(e) && <span className="block truncate text-[13px] text-ink-2">{detail(e)}</span>}
                </span>
                <span className="row-start-1 text-right text-[12px] text-ink-3 md:row-start-auto" title={`#${e.seq} · ${e.hash.slice(0, 16)}…`}>{relTime(e.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
