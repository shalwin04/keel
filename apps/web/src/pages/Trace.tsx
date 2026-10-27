import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type TraceRow } from "../api.ts";

const STEPS: { node: string; label: string; what: string }[] = [
  { node: "ingest", label: "Watch", what: "Reads ads, creatives, enhancement settings and served variants" },
  { node: "detectDrift", label: "Check settings", what: "Compares enhancement settings with the locked baseline" },
  { node: "screen", label: "Screen", what: "Open-weight model scores every variant" },
  { node: "inspect", label: "Inspect", what: "SAM 3.1 isolates regions, Muse Spark compares them" },
  { node: "investigate", label: "Investigate", what: "Muse Wonder resolves unclear cases" },
  { node: "decide", label: "Decide", what: "Fixed policy turns findings into proposals" },
  { node: "notify", label: "Alert", what: "Review card and push alert" },
  { node: "requestApproval", label: "Wait for you", what: "Paused until someone decides" },
  { node: "act", label: "Act", what: "Makes the approved change through the Marketing API" },
  { node: "verify", label: "Verify", what: "Reads the ad back from Meta to confirm" },
  { node: "learn", label: "Learn", what: "Records the outcome and closes the audit entry" },
];

type StepState = { status: "waiting" | "running" | "done" | "paused" | "failed"; ms?: number; summary: Record<string, unknown> };

function stepStates(events: TraceRow[]) {
  const out: Record<string, StepState> = {};
  for (const e of events) {
    if (!e.node) continue;
    if (e.kind === "node_start") out[e.node] = { status: "running", summary: {} };
    if (e.kind === "node_end") {
      const { ms, paused, ...summary } = e.data as { ms?: number; paused?: boolean };
      out[e.node] = { status: paused ? "paused" : "done", ms, summary };
    }
    if (e.kind === "error") out[e.node] = { status: "failed", summary: e.data };
  }
  return out;
}

const dot: Record<StepState["status"], string> = {
  waiting: "border-fog bg-chart",
  running: "border-brass bg-brass animate-pulse",
  done: "border-starboard bg-starboard",
  paused: "border-brass bg-chart",
  failed: "border-port bg-port",
};

const fmtSummary = (s: Record<string, unknown>) =>
  Object.entries(s).filter(([, v]) => typeof v === "number" || typeof v === "string").map(([k, v]) => `${v} ${k}`).join(", ");

export function Trace({ cycleId: initial }: { cycleId?: string }) {
  const cycles = useQuery({ queryKey: ["cycles"], queryFn: api.cycles, refetchInterval: 30_000 });
  const [cycleId, setCycleId] = useState(initial);
  useEffect(() => { if (!cycleId && cycles.data?.[0]) setCycleId(cycles.data[0].id); }, [cycles.data, cycleId]);

  const trace = useQuery({ queryKey: ["trace", cycleId], queryFn: () => api.trace(cycleId!), enabled: !!cycleId });
  const events = trace.data?.events ?? [];
  const states = stepStates(events);
  const calls = events.filter((e) => e.kind === "model_call");
  const totalCost = calls.reduce((n, e) => n + (Number(e.data.costUsd) || 0), 0);
  const byModel = [...calls.reduce((m, e) => {
    const key = `${e.data.tier ?? e.node}|${e.data.model}`;
    const row = m.get(key) ?? { tier: String(e.data.tier ?? e.node), model: String(e.data.model), n: 0, ms: 0, cost: 0 };
    row.n += 1; row.ms += Number(e.data.ms) || 0; row.cost += Number(e.data.costUsd) || 0;
    return m.set(key, row);
  }, new Map<string, { tier: string; model: string; n: number; ms: number; cost: number }>()).values()];

  if (cycles.isLoading) return <p className="text-hull-soft">Loading cycles…</p>;
  if (!cycles.data?.length) {
    return (
      <div className="max-w-xl">
        <h1 className="display text-4xl font-semibold">No cycles yet</h1>
        <p className="mt-3 text-hull-soft">Run a check from Accounts and watch each step here as it happens.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold">Live trace</h1>
          <p className="text-hull-soft">Every step of a check, as Keel runs it. Models are only called in Screen, Inspect and Investigate.</p>
        </div>
        <label className="text-sm">
          <span className="mr-2 text-hull-soft">Cycle</span>
          <select value={cycleId} onChange={(e) => setCycleId(e.target.value)} className="rounded-sm border border-fog/60 bg-chart px-2 py-1.5">
            {cycles.data.map((c) => (
              <option key={c.id} value={c.id}>{new Date(c.startedAt).toLocaleString()} ({c.status.replace("_", " ")})</option>
            ))}
          </select>
        </label>
      </header>

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
        <ol className="relative">
          {STEPS.map((s, i) => {
            const st = states[s.node] ?? { status: "waiting" as const, summary: {} };
            return (
              <li key={s.node} className="relative flex gap-4 pb-6 last:pb-0">
                {i < STEPS.length - 1 && <span aria-hidden className="absolute left-[9px] top-5 h-full w-px bg-fog/50" />}
                <span aria-hidden className={`relative z-10 mt-1 h-[19px] w-[19px] shrink-0 rounded-full border-2 ${dot[st.status]}`} />
                <div className={st.status === "waiting" ? "opacity-55" : ""}>
                  <p className="font-semibold">
                    {s.label}
                    <span className="ml-2 text-sm font-normal text-hull-soft">
                      {st.status === "paused" ? "waiting for a decision" : st.status === "running" ? "running" : st.ms != null ? `${st.ms} ms` : ""}
                    </span>
                  </p>
                  <p className="text-sm text-hull-soft">{s.what}</p>
                  {fmtSummary(st.summary) && <p className="mt-1 text-sm">{fmtSummary(st.summary)}</p>}
                  {st.status === "failed" && <p className="mt-1 text-sm text-port">{String(st.summary.message ?? "Step failed")}</p>}
                </div>
              </li>
            );
          })}
        </ol>

        <section aria-labelledby="calls">
          <h2 id="calls" className="font-semibold">Model calls</h2>
          <p className="text-sm text-hull-soft">{calls.length} calls{totalCost ? `, about $${totalCost.toFixed(4)}` : ""}</p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-hull-soft">
              <tr><th className="py-1 pr-3 font-normal">Step and model</th><th className="pr-3 text-right font-normal">Calls</th><th className="whitespace-nowrap text-right font-normal">Avg time</th></tr>
            </thead>
            <tbody className="divide-y divide-fog/30">
              {byModel.map((r) => (
                <tr key={`${r.tier}|${r.model}`} className="align-top">
                  <td className="py-2 pr-3">
                    <span className="block font-medium capitalize">{r.tier}</span>
                    <span className="block break-all text-hull-soft">{r.model}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">{r.n}</td>
                  <td className="whitespace-nowrap py-2 text-right">{Math.round(r.ms / r.n)} ms</td>
                </tr>
              ))}
              {!calls.length && <tr><td colSpan={3} className="py-2 text-hull-soft">No model calls in this cycle yet.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
