import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { api, type Cycle, type TraceRow } from "../api.ts";
import { IconCheck, IconPlay, IconPulse, IconX } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, Empty, ErrorNote, PageHeader, Pill, SectionTitle, Skeleton, Spinner, cx, relTime } from "../components/ui.tsx";

const STEPS: { node: string; label: string; what: string }[] = [
  { node: "ingest", label: "Read the account", what: "Ads, creatives, enhancement settings and rendered previews" },
  { node: "detectDrift", label: "Check settings", what: "Compare each ad's AI enhancements with what you approved" },
  { node: "screen", label: "Screen variants", what: "A fast open-weight model scores every variant" },
  { node: "inspect", label: "Inspect", what: "SAM 3.1 isolates regions; Muse Spark compares them" },
  { node: "investigate", label: "Investigate", what: "Muse Wonder settles the unclear cases" },
  { node: "decide", label: "Decide", what: "A fixed policy turns findings into proposals" },
  { node: "notify", label: "Alert", what: "Review card and push alert" },
  { node: "requestApproval", label: "Wait for you", what: "Nothing changes until someone decides" },
  { node: "act", label: "Act", what: "Make the approved change through the Marketing API" },
  { node: "verify", label: "Verify", what: "Read the ad back from Meta to confirm" },
  { node: "learn", label: "Learn", what: "Record the outcome; dismissed findings aren't raised again" },
];

type StepState = { status: "waiting" | "running" | "done" | "paused" | "failed" | "skipped"; ms?: number; summary: Record<string, unknown>; error?: string };

function stepStates(events: TraceRow[], cycle?: Cycle) {
  const out: Record<string, StepState> = {};
  for (const e of events) {
    if (!e.node) continue;
    if (e.kind === "node_start") out[e.node] = { status: "running", summary: {} };
    if (e.kind === "node_end") {
      const { ms, paused, ...summary } = e.data as { ms?: number; paused?: boolean };
      out[e.node] = { status: paused ? "paused" : "done", ms, summary };
    }
    if (e.kind === "error" && out[e.node]?.status === "running") out[e.node] = { ...out[e.node]!, status: "failed", error: String(e.data.message ?? "") };
  }
  const finished = cycle && ["completed", "failed", "expired"].includes(cycle.status);
  if (finished) for (const s of STEPS) if (!out[s.node]) out[s.node] = { status: "skipped", summary: {} };
  return out;
}

const STATUS: Record<string, { label: string; tone: "ok" | "accent" | "critical" | "neutral" | "medium" }> = {
  running: { label: "Running", tone: "accent" }, awaiting_approval: { label: "Waiting for you", tone: "medium" },
  completed: { label: "Done", tone: "ok" }, failed: { label: "Failed", tone: "critical" }, expired: { label: "Expired", tone: "neutral" },
};

const fmtSummary = (s: Record<string, unknown>) =>
  Object.entries(s).filter(([, v]) => typeof v === "number" || typeof v === "string").map(([k, v]) => `${v} ${k}`).join(" · ");
const fmtMs = (ms?: number) => (ms === undefined ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function Activity({ cycleId }: { cycleId?: string }) {
  const cycles = useQuery({ queryKey: ["cycles"], queryFn: api.cycles, refetchInterval: 20_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const selected = cycleId ?? cycles.data?.[0]?.id;
  const nameOf = (id: string) => me.data?.accounts.find((a) => a.metaAccountId === id)?.name ?? id;
  const runnable = me.data?.accounts.filter((a) => !a.isDemo && a.role !== "viewer") ?? [];

  const run = useMutation({
    mutationFn: (id: string) => api.runCycle(id),
    onSuccess: (r) => { toast("Check started"); void qc.invalidateQueries({ queryKey: ["cycles"] }); void navigate({ to: "/activity", search: { cycle: r.cycleId } }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });

  return (
    <div>
      <PageHeader title="Activity" subtitle="Every check Keel runs, step by step, as it happens."
        actions={runnable.length > 0 && (
          <Button variant="primary" icon={<IconPlay size={14} />} loading={run.isPending} onClick={() => run.mutate(runnable[0]!.metaAccountId)}>
            Check {runnable.length === 1 ? "now" : runnable[0]!.name}
          </Button>
        )} />
      {cycles.isLoading ? <Skeleton className="h-96" /> : cycles.isError ? <ErrorNote error={cycles.error} /> : !cycles.data?.length ? (
        <Card><Empty icon={<IconPulse size={26} />} title="No checks yet">The worker checks each account on its schedule. You can also start one now.</Empty></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="max-h-[70vh] overflow-auto scroll-thin">
            <ul className="divide-y divide-[var(--line)]">
              {cycles.data.map((c) => {
                const st = STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
                return (
                  <li key={c.id}>
                    <button onClick={() => navigate({ to: "/activity", search: { cycle: c.id } })}
                      className={cx("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150", c.id === selected ? "bg-accent/8" : "hover:bg-fill")}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium">{nameOf(c.accountId)}</div>
                        <div className="text-[13px] text-ink-2">{new Date(c.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                      </div>
                      <Pill tone={st.tone}>{c.status === "running" && <Spinner className="h-3 w-3" />}{st.label}</Pill>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          {selected && <CycleDetail key={selected} cycleId={selected} accountName={nameOf} />}
        </div>
      )}
    </div>
  );
}

function CycleDetail({ cycleId, accountName }: { cycleId: string; accountName: (id: string) => string }) {
  // Live events update the trace; polling while a check is open is the safety net if a stream drops.
  const trace = useQuery({
    queryKey: ["trace", cycleId], queryFn: () => api.trace(cycleId),
    refetchInterval: (q) => (q.state.data && ["running", "awaiting_approval"].includes(q.state.data.cycle.status) ? 4000 : false),
  });
  const qc = useQueryClient();
  const events = trace.data?.events ?? [];
  const cycle = trace.data?.cycle;
  const states = stepStates(events, cycle);
  const done = events.some((e) => e.kind === "cycle_end");
  useEffect(() => { if (done) void qc.invalidateQueries({ queryKey: ["cycles"] }); }, [done, qc]);

  const calls = events.filter((e) => e.kind === "model_call");
  const cost = calls.reduce((n, e) => n + (Number(e.data.costUsd) || 0), 0);
  const byModel = useMemo(() => [...calls.reduce((m, e) => {
    const key = `${e.data.tier ?? e.node}|${e.data.model}`;
    const row = m.get(key) ?? { tier: String(e.data.tier ?? e.node), model: String(e.data.model), n: 0, ms: 0, cost: 0 };
    row.n += 1; row.ms += Number(e.data.ms) || 0; row.cost += Number(e.data.costUsd) || 0;
    return m.set(key, row);
  }, new Map<string, { tier: string; model: string; n: number; ms: number; cost: number }>()).values()], [calls]);
  const actions = events.filter((e) => e.kind === "action");
  const errors = events.filter((e) => e.kind === "error");

  if (trace.isLoading) return <Skeleton className="h-[520px]" />;
  if (trace.isError) return <ErrorNote error={trace.error} />;

  return (
    <div className="min-w-0 space-y-6 animate-enter">
      <Card className="p-5 md:p-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[20px] font-semibold">{cycle ? accountName(cycle.accountId) : "Check"}</h2>
          <span className="text-[13px] text-ink-2">{cycle && `Started ${relTime(cycle.startedAt)}`}{cost > 0 && ` · $${cost.toFixed(4)}`}</span>
        </div>
        {cycle?.error && <p className="mb-4 rounded-xl bg-critical/10 px-3 py-2 text-[14px] text-critical">{cycle.error}</p>}
        <ol className="relative">
          {STEPS.map((s, i) => {
            const st = states[s.node] ?? { status: "waiting", summary: {} };
            return (
              <li key={s.node} className="relative flex gap-4 pb-4 last:pb-0">
                {i < STEPS.length - 1 && <span className={cx("absolute top-6 left-[11px] h-[calc(100%-16px)] w-px", st.status === "done" ? "bg-ok/40" : "bg-[var(--line)]")} />}
                <StepIcon status={st.status} />
                <div className={cx("min-w-0 flex-1 pt-0.5", st.status === "skipped" && "opacity-45")}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{s.label}</span>
                    {st.status === "paused" && <span className="text-[13px] font-medium text-medium">waiting for a decision</span>}
                    {st.ms !== undefined && <span className="text-[12px] text-ink-3">{fmtMs(st.ms)}</span>}
                  </div>
                  <p className="text-[13px] text-ink-2">{st.error ?? (fmtSummary(st.summary) || s.what)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {byModel.length > 0 && (
        <div>
          <SectionTitle>Model calls</SectionTitle>
          <Card className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead className="text-left text-[12px] text-ink-2"><tr className="border-b hairline"><th className="px-4 py-2.5 font-medium">Step</th><th className="px-4 font-medium">Model</th><th className="px-4 text-right font-medium">Calls</th><th className="px-4 text-right font-medium">Time</th><th className="px-4 text-right font-medium">Cost</th></tr></thead>
              <tbody className="divide-y divide-[var(--line)]">
                {byModel.map((r) => (
                  <tr key={r.tier + r.model}><td className="px-4 py-2.5 capitalize">{r.tier}</td><td className="px-4 font-mono text-[13px]">{r.model}</td><td className="px-4 text-right">{r.n}</td><td className="px-4 text-right">{fmtMs(r.ms)}</td><td className="px-4 text-right">{r.cost ? `$${r.cost.toFixed(4)}` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {(actions.length > 0 || errors.length > 0) && (
        <div>
          <SectionTitle>Actions and warnings</SectionTitle>
          <Card className="divide-y divide-[var(--line)]">
            {[...actions, ...errors].sort((a, b) => a.seq - b.seq).map((e) => (
              <div key={e.seq} className="flex items-start gap-3 px-4 py-3 text-[14px]">
                <span className={e.kind === "error" || e.data.ok === false ? "text-critical" : "text-ok"}>{e.kind === "error" || e.data.ok === false ? <IconX size={16} /> : <IconCheck size={16} />}</span>
                <span className="min-w-0 flex-1">{String(e.data.detail ?? e.data.message ?? "")}{e.data.phase === "verify" && <span className="text-ink-3"> · verified</span>}</span>
                <span className="text-[12px] text-ink-3">{new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: StepState["status"] }) {
  const base = "relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full";
  if (status === "done") return <span className={cx(base, "bg-ok text-white")}><IconCheck size={14} strokeWidth={2.5} /></span>;
  if (status === "failed") return <span className={cx(base, "bg-critical text-white")}><IconX size={14} strokeWidth={2.5} /></span>;
  if (status === "running") return <span className={cx(base, "bg-accent/15 text-accent")}><Spinner className="h-3.5 w-3.5" /></span>;
  if (status === "paused") return <span className={cx(base, "bg-medium/20")}><span className="h-2 w-2 animate-pulse-soft rounded-full bg-medium" /></span>;
  return <span className={cx(base, "border-[1.5px] border-[var(--line)] bg-surface")} />;
}
