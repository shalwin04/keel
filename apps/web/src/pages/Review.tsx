import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ACTION_LABEL, CODE_LABEL, SEVERITY_ORDER, api, featureLabel, type QueueItem } from "../api.ts";
import { CompareViewer } from "../components/CompareViewer.tsx";
import { IconCheck, IconChevron, IconInbox, IconSparkle, IconX } from "../components/Icons.tsx";
import { SeverityDot, SeverityPill } from "../components/Severity.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, Empty, ErrorNote, Kbd, Pill, Segmented, Skeleton, cx, relTime } from "../components/ui.tsx";

const worst = (q: QueueItem) => Math.min(...q.findings.map((f) => SEVERITY_ORDER.indexOf(f.severity)), 3);

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m to decide` : `${m}m to decide`;
}

const titleOf = (q: QueueItem) => {
  const f = q.findings[0];
  if (!f) return ACTION_LABEL[q.action] ?? q.action;
  if (f.code === "SETTING_DRIFT") {
    const name = f.evidence[0]?.replace("creative_features_spec.", "");
    return name ? `${featureLabel(name)} was switched on` : CODE_LABEL[f.code];
  }
  return f.summary;
};

export function Review({ selectedId }: { selectedId?: string }) {
  const [tab, setTab] = useState<"pending" | "history">("pending");
  return (
    <div>
      <Overview />
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-[28px] font-semibold md:text-[32px]">Review</h1>
        <Segmented label="Queue" value={tab} onChange={setTab} options={[{ value: "pending", label: "To review" }, { value: "history", label: "Decided" }]} />
      </div>
      {tab === "pending" ? <Pending selectedId={selectedId} /> : <History />}
    </div>
  );
}

function Overview() {
  const o = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 60_000 });
  const d = o.data;
  const stats = [
    { label: "Ads watched", value: d?.ads },
    { label: "Open findings", value: d?.openFindings },
    { label: "Fixed this week", value: d?.actions7d },
    { label: "Checks today", value: d?.cycles24h },
    { label: "Model spend · 7d", value: d ? `$${d.costUsd7d.toFixed(2)}` : undefined },
  ];
  return (
    <div className="scroll-thin -mx-4 mb-6 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:mb-8 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
      {stats.map((s) => (
        <Card key={s.label} className="min-w-[132px] shrink-0 snap-start px-4 py-3 md:min-w-0 md:py-3.5">
          <div className="text-[12px] font-medium whitespace-nowrap text-ink-2">{s.label}</div>
          {s.value === undefined ? <Skeleton className="mt-1.5 h-7 w-12" /> : <div className="mt-0.5 text-[22px] font-semibold tracking-tight md:text-[26px]">{s.value}</div>}
        </Card>
      ))}
    </div>
  );
}

function Pending({ selectedId }: { selectedId?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const queue = useQuery({ queryKey: ["queue", "pending"], queryFn: () => api.queue("pending"), refetchInterval: 60_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const items = useMemo(() => [...(queue.data ?? [])].sort((a, b) => worst(a) - worst(b) || +new Date(b.createdAt) - +new Date(a.createdAt)), [queue.data]);
  const [current, setCurrent] = useState<string | undefined>(selectedId);
  const [masks, setMasks] = useState(true);
  const [mobileDetail, setMobileDetail] = useState(Boolean(selectedId));

  const item = items.find((i) => i.id === current) ?? items[0];
  const account = me.data?.accounts.find((a) => a.metaAccountId === item?.accountId);
  const canAct = Boolean(account && (account.role !== "viewer" || account.isDemo));

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" | "replace" }) => api.decide(id, decision),
    onMutate: ({ id }) => {
      // Optimistic: the card leaves the queue right away; it comes back if the server says no.
      const prev = qc.getQueryData<QueueItem[]>(["queue", "pending"]);
      const idx = items.findIndex((i) => i.id === id);
      setCurrent(items[idx + 1]?.id ?? items[idx - 1]?.id);
      qc.setQueryData<QueueItem[]>(["queue", "pending"], (old) => old?.filter((x) => x.id !== id));
      return { prev };
    },
    onSuccess: (_r, v) => {
      toast(v.decision === "reject" ? "Left running. Keel won't ask about this again." : v.decision === "replace" ? "Making an on-brand replacement" : "Approved. Keel is making the change.");
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["queue", "history"] });
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(["queue", "pending"], ctx?.prev);
      toast(e instanceof Error ? e.message : String(e), "error");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["queue", "pending"] }),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = items.findIndex((i) => i.id === item?.id);
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setCurrent(items[Math.min(items.length - 1, idx + 1)]?.id); }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setCurrent(items[Math.max(0, idx - 1)]?.id); }
      if (e.key === "m") setMasks((v) => !v);
      if (!item || !canAct || decide.isPending) return;
      if (e.key === "a") decide.mutate({ id: item.id, decision: "approve" });
      if (e.key === "r") decide.mutate({ id: item.id, decision: "reject" });
      if (e.key === "p") decide.mutate({ id: item.id, decision: "replace" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, item, decide, canAct]);

  if (queue.isLoading) return <div className="grid gap-6 lg:grid-cols-[320px_1fr]"><Skeleton className="h-64" /><Skeleton className="h-[480px]" /></div>;
  if (queue.isError) return <ErrorNote error={queue.error} />;
  if (!items.length) {
    const isDemo = me.data?.accounts.some((a) => a.isDemo);
    return (
      <Card>
        <Empty icon={<IconCheck size={26} />} title="You're all caught up"
          action={isDemo ? <Button onClick={async () => { await api.resetDemo(); await qc.invalidateQueries(); }}>Reset the demo</Button>
            : !me.data?.accounts.length ? <Link to="/settings"><Button variant="primary">Connect an ad account</Button></Link> : undefined}>
          {me.data?.accounts.length
            ? "Every ad Keel watches matches what you approved. When Meta serves something off-brand, it shows up here first."
            : "Connect a Meta ad account and Keel starts watching what Advantage+ does to your ads."}
        </Empty>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section aria-label="Findings to review" className={cx("min-w-0", mobileDetail && "hidden lg:block")}>
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--line)]">
            {items.map((q, i) => {
              const top = q.findings[0];
              const active = q.id === item?.id;
              return (
                <li key={q.id} className="animate-enter" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                  <button onClick={() => { setCurrent(q.id); setMobileDetail(true); }} aria-current={active}
                    className={cx("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150", active ? "bg-accent/8 lg:shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-fill")}>
                    {top && <SeverityDot severity={top.severity} className="mt-[7px]" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{titleOf(q)}</span>
                      <span className="block truncate text-[13px] text-ink-2">{q.adName} · {relTime(q.createdAt)}</span>
                    </span>
                    <IconChevron size={16} className="mt-1 text-ink-3 lg:hidden" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        <ul className="hover-only mt-3 hidden flex-wrap gap-x-3 gap-y-1.5 px-1 text-[12px] text-ink-3 lg:flex">
          {([["J K", "move"], ["A", "approve"], ["R", "keep"], ["P", "replace"], ["M", "outlines"]] as const).map(([k, l]) => (
            <li key={l} className="flex items-center gap-1 whitespace-nowrap">{k.split(" ").map((x) => <Kbd key={x}>{x}</Kbd>)}<span className="ml-0.5">{l}</span></li>
          ))}
        </ul>
      </section>

      {item && (
        <article key={item.id} aria-labelledby="finding-title" className={cx("min-w-0 animate-enter", !mobileDetail && "hidden lg:block")}>
          <button className="mb-3 flex items-center gap-1 text-accent lg:hidden" onClick={() => setMobileDetail(false)}>
            <IconChevron size={16} className="rotate-180" /> All findings
          </button>
          <Card className="p-4 md:p-6">
            <header className="mb-5">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                {item.findings[0] && <SeverityPill severity={item.findings[0].severity} />}
                <span>{item.adName}</span><span className="text-ink-3">·</span><span>{item.accountName}</span>
                <span className="ml-auto">{timeLeft(item.expiresAt)}</span>
              </div>
              <h2 id="finding-title" className="mt-3 text-[22px] leading-snug font-semibold md:text-[26px]">{titleOf(item)}</h2>
            </header>

            <CompareViewer originalRef={item.findings.find((f) => f.originalRef)?.originalRef ?? null} variantRef={item.findings.find((f) => f.variantRef)?.variantRef ?? null}
              regions={item.findings.flatMap((x) => x.regions)} showMasks={masks} />
            {item.findings.some((f) => f.variantRef && f.regions.length) && (
              <button className="mt-2 text-[13px] text-accent" onClick={() => setMasks((v) => !v)}>{masks ? "Hide" : "Show"} outlines</button>
            )}

            <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
              <section>
                <h3 className="text-[13px] font-semibold text-ink-2">What Keel found</h3>
                <ul className="mt-2 space-y-3">
                  {item.findings.map((x) => (
                    <li key={x.id} className="flex gap-3">
                      <SeverityDot severity={x.severity} className="mt-[7px]" />
                      <div className="min-w-0">
                        <p className="font-medium">{CODE_LABEL[x.code] ?? x.code} <span className="font-normal text-ink-2">· {Math.round(x.confidence * 100)}% sure</span></p>
                        <p className="text-[14px] text-ink-2">{x.code === "SETTING_DRIFT" ? `${x.summary.replace(/_/g, " ")}. You approved this ad with it off.` : x.summary}</p>
                        {x.evidence.filter((e) => !e.startsWith("creative_features_spec")).length > 0 && (
                          <p className="mt-1 text-[13px] text-ink-3">{x.evidence.filter((e) => !e.startsWith("creative_features_spec")).join(" · ")}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-2xl bg-fill p-4">
                <h3 className="text-[13px] font-semibold text-ink-2">Keel proposes</h3>
                <p className="mt-1 mb-4 text-[17px] font-semibold">{ACTION_LABEL[item.action] ?? item.action}</p>
                <div className="flex flex-col gap-2">
                  <Button variant="primary" size="lg" disabled={!canAct} loading={decide.isPending && decide.variables?.decision === "approve"}
                    icon={<IconCheck size={18} />} onClick={() => decide.mutate({ id: item.id, decision: "approve" })}>Approve</Button>
                  {item.findings.some((f) => f.variantRef) && (
                    <Button disabled={!canAct} icon={<IconSparkle size={16} />} onClick={() => decide.mutate({ id: item.id, decision: "replace" })}>Replace with an on-brand version</Button>
                  )}
                  <Button variant="plain" disabled={!canAct} icon={<IconX size={16} />} onClick={() => decide.mutate({ id: item.id, decision: "reject" })}>Keep it running</Button>
                </div>
                {!canAct && <p className="mt-3 text-[13px] text-ink-2">You can view this workspace. Owners and reviewers decide.</p>}
                {account?.isDemo && <p className="mt-3 text-[13px] text-ink-2">Demo: decisions are simulated.</p>}
              </section>
            </div>
          </Card>
        </article>
      )}
    </div>
  );
}

const OUTCOME: Record<string, { label: string; tone: "ok" | "critical" | "neutral" | "medium" }> = {
  executed: { label: "Fixed", tone: "ok" }, approved: { label: "Approved", tone: "ok" }, failed: { label: "Failed", tone: "critical" },
  rejected: { label: "Kept running", tone: "neutral" }, expired: { label: "Expired", tone: "medium" }, stale: { label: "Superseded", tone: "neutral" },
};

function History() {
  const q = useQuery({ queryKey: ["queue", "history"], queryFn: () => api.queue("history") });
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorNote error={q.error} />;
  if (!q.data?.length) return <Card><Empty icon={<IconInbox size={26} />} title="No decisions yet">Approvals, rejections and their results will be listed here.</Empty></Card>;
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-[var(--line)]">
        {q.data.map((x) => {
          const o = OUTCOME[x.status] ?? { label: x.status, tone: "neutral" as const };
          const detail = x.outcome?.verified?.detail ?? x.outcome?.executed?.detail;
          return (
            <li key={x.id} className="flex items-start gap-3 px-4 py-3.5">
              {x.findings[0] && <SeverityDot severity={x.findings[0].severity} className="mt-[7px]" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{titleOf(x)}</p>
                <p className="truncate text-[13px] text-ink-2">
                  {x.adName} · {x.decision ? `${x.decision.name} chose ${x.decision.decision === "reject" ? "to keep it" : x.decision.decision} ${relTime(x.decision.decidedAt)}` : relTime(x.createdAt)}
                </p>
                {detail && <p className="mt-0.5 text-[13px] text-ink-3">{detail}</p>}
              </div>
              <Pill tone={o.tone}>{o.label}</Pill>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
