import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ACTION_LABEL, CODE_LABEL, SEVERITY_ORDER, api, type QueueItem } from "../api.ts";
import { CompareViewer } from "../components/CompareViewer.tsx";
import { SeverityMark } from "../components/Severity.tsx";

const worst = (q: QueueItem) => Math.min(...q.findings.map((f) => SEVERITY_ORDER.indexOf(f.severity)), 3);

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m left` : `${m}m left`;
}

export function Review({ selectedId }: { selectedId?: string }) {
  const qc = useQueryClient();
  const queue = useQuery({ queryKey: ["queue", "pending"], queryFn: () => api.queue("pending"), refetchInterval: 60_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const items = useMemo(() => [...(queue.data ?? [])].sort((a, b) => worst(a) - worst(b)), [queue.data]);
  const [current, setCurrent] = useState<string | undefined>(selectedId);
  const [masks, setMasks] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const item = items.find((i) => i.id === current) ?? items[0];
  const account = me.data?.accounts.find((a) => a.metaAccountId === item?.accountId);
  const role = account?.role;
  const isDemo = me.data?.accounts.some((a) => a.isDemo) ?? false;

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" | "replace" }) => api.decide(id, decision),
    onSuccess: (_r, v) => {
      setNotice(v.decision === "reject" ? "Left as is. Keel won't act on this one." : v.decision === "replace" ? "Making an on-brand replacement. Follow it in the live trace." : "Approved. Keel is making the change and will confirm it.");
      const idx = items.findIndex((i) => i.id === v.id);
      setCurrent(items[idx + 1]?.id ?? items[idx - 1]?.id);
      void qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => setNotice(e instanceof Error ? e.message : String(e)),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      const idx = items.findIndex((i) => i.id === item?.id);
      if (e.key === "j") setCurrent(items[Math.min(items.length - 1, idx + 1)]?.id);
      if (e.key === "k") setCurrent(items[Math.max(0, idx - 1)]?.id);
      if (e.key === "m") setMasks((v) => !v);
      if (!item || decide.isPending) return;
      if (e.key === "a") decide.mutate({ id: item.id, decision: "approve" });
      if (e.key === "r") decide.mutate({ id: item.id, decision: "reject" });
      if (e.key === "p") decide.mutate({ id: item.id, decision: "replace" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, item, decide]);

  if (queue.isLoading) return <p className="text-hull-soft">Loading the review queue…</p>;
  if (queue.isError) return <p role="alert" className="text-port">Couldn't load the review queue: {String(queue.error)}</p>;

  if (!items.length) {
    return (
      <div className="max-w-xl">
        <h1 className="display text-4xl font-semibold">Nothing to review</h1>
        <p className="mt-3 text-hull-soft">Every ad Keel watches matches its approved creative. When Meta serves something off-brand, it lands here and on your phone if alerts are on.</p>
        {notice && <p className="mt-6 text-starboard">{notice}</p>}
        {isDemo && (
          <button onClick={async () => { await api.resetDemo(); await qc.invalidateQueries(); }} className="mt-6 rounded-sm border border-hull px-4 py-2.5 font-medium hover:bg-chart-deep">
            Reset the demo
          </button>
        )}
      </div>
    );
  }

  const f = item?.findings[0];
  const canAct = (role && role !== "viewer") || account?.isDemo;

  return (
    <div className="grid gap-8 xl:grid-cols-[20rem_1fr]">
      <section aria-label="Findings to review">
        <h1 className="display mb-4 text-3xl font-semibold">{items.length} to review</h1>
        <ul className="divide-y divide-fog/30 border-y border-fog/30">
          {items.map((q) => {
            const top = q.findings[0];
            const active = q.id === item?.id;
            return (
              <li key={q.id}>
                <button
                  onClick={() => setCurrent(q.id)}
                  aria-current={active}
                  className={`flex w-full items-start gap-3 px-2 py-3 text-left ${active ? "bg-chart-deep shadow-[inset_3px_0_0_var(--color-brass)]" : "hover:bg-chart-deep/60"}`}
                >
                  {top && <span className="mt-1"><SeverityMark severity={top.severity} /></span>}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{top ? CODE_LABEL[top.code] ?? top.code : q.action}</span>
                    <span className="block truncate text-sm text-hull-soft">{top?.summary ?? q.reason}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 hidden text-sm text-hull-soft md:block">Keys: J and K to move, A approve, R leave it, P replace, M masks.</p>
      </section>

      {item && f && (
        <article aria-labelledby="finding-title" className="min-w-0">
          <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <div>
              <p className="flex items-center gap-3"><SeverityMark severity={f.severity} withLabel /><span className="text-hull-soft">{item.adName}</span></p>
              <h2 id="finding-title" className="display mt-1 text-3xl font-semibold">{f.summary}</h2>
            </div>
            <p className="text-sm text-hull-soft">{timeLeft(item.expiresAt)}</p>
          </header>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div>
              <CompareViewer originalRef={f.originalRef} variantRef={f.variantRef} regions={item.findings.flatMap((x) => x.regions)} showMasks={masks} />
              <label className="mt-3 inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={masks} onChange={(e) => setMasks(e.target.checked)} className="accent-brass" />
                Outline what changed
              </label>
            </div>

            <div className="space-y-6">
              <section>
                <h3 className="font-semibold">What Keel found</h3>
                <ul className="mt-2 space-y-3">
                  {item.findings.map((x) => (
                    <li key={x.id}>
                      <p className="font-medium">{CODE_LABEL[x.code] ?? x.code} <span className="font-normal text-hull-soft">({Math.round(x.confidence * 100)}% sure)</span></p>
                      <p className="text-sm text-hull-soft">{x.evidence.join("; ")}</p>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="font-semibold">Keel proposes</h3>
                <p className="mt-1">{ACTION_LABEL[item.action] ?? item.action}</p>
              </section>

              <div className="flex flex-col gap-2">
                <button disabled={!canAct || decide.isPending} onClick={() => decide.mutate({ id: item.id, decision: "approve" })}
                  className="rounded-sm bg-hull px-4 py-2.5 font-medium text-chart hover:bg-hull/90 disabled:opacity-40">
                  {ACTION_LABEL[item.action] ?? "Approve"}
                </button>
                <button disabled={!canAct || decide.isPending} onClick={() => decide.mutate({ id: item.id, decision: "replace" })}
                  className="rounded-sm border border-brass px-4 py-2.5 font-medium text-hull hover:bg-brass/10 disabled:opacity-40">
                  Make an on-brand replacement
                </button>
                <button disabled={!canAct || decide.isPending} onClick={() => decide.mutate({ id: item.id, decision: "reject" })}
                  className="rounded-sm px-4 py-2.5 text-hull-soft hover:text-hull disabled:opacity-40">
                  Leave it running
                </button>
                {!canAct && <p className="text-sm text-hull-soft">You're viewing this workspace. Owners and reviewers can decide.</p>}
                {account?.isDemo && <p className="text-sm text-hull-soft">Demo workspace: decisions are simulated and change no real ad.</p>}
                {notice && <p role="status" className="text-sm text-starboard">{notice}</p>}
              </div>
            </div>
          </div>
        </article>
      )}
    </div>
  );
}
