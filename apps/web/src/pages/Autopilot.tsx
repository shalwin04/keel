import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { adsManagerUrl, autopilot, mediaUrl, type AutopilotDetail, type Move } from "../api.ts";
import { IconArrowRight, IconCheck, IconChevron, IconLink, IconLock, IconPlay, IconRefresh, IconSparkle, IconX } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, ErrorNote, Pill, SectionTitle, Skeleton, Spinner, cx, relTime } from "../components/ui.tsx";

export const AUTOPILOT_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "critical" | "medium" }> = {
  reading: { label: "Reading your site", tone: "accent" }, crafting: { label: "Making the campaign", tone: "accent" }, ready: { label: "Ready to launch", tone: "medium" },
  launching: { label: "Launching", tone: "accent" }, live: { label: "Running", tone: "ok" }, stopped: { label: "Autopilot paused", tone: "neutral" }, failed: { label: "Needs attention", tone: "critical" },
};
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
const money = (n: number, cur?: string) => { try { return new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-US", { style: cur ? "currency" : "decimal", currency: cur || undefined, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n); } catch { return n.toFixed(2); } };

type StageState = "done" | "running" | "waiting" | "attention";
function stages(a: AutopilotDetail): { key: string; label: string; state: StageState; detail?: string }[] {
  const steps = a.project?.steps ?? [];
  const step = (k: string) => steps.find((s) => s.key === k)?.status;
  const craftKeys = ["strategy", "scenes", "compose", "check", "storyboard"];
  const crafted = a.project?.status === "ready" || a.project?.status === "launched";
  const live = a.status === "live" || a.status === "stopped";
  const pending = (a.moves ?? []).filter((m) => m.status === "pending").length;
  return [
    { key: "site", label: "Read the site", state: a.profile ? "done" : a.status === "reading" ? "running" : a.status === "failed" ? "attention" : "waiting", detail: a.site ? `${a.site.products.length} products` : undefined },
    { key: "research", label: "Research", state: step("research") === "done" ? "done" : step("research") === "running" ? "running" : step("research") === "failed" ? "attention" : "waiting", detail: a.project?.research ? `${a.project.research.ads} competitor ads` : undefined },
    { key: "craft", label: "Craft", state: crafted ? "done" : craftKeys.some((k) => step(k) === "running") ? "running" : craftKeys.some((k) => step(k) === "failed") ? "attention" : "waiting", detail: a.project?.directions.length ? `${a.project.directions.length} directions` : undefined },
    { key: "launch", label: "Launch", state: a.project?.launch ? "done" : a.status === "ready" ? "attention" : a.status === "launching" ? "running" : "waiting", detail: a.project?.launch ? (a.project.launch.active ? "On" : "Paused") : a.status === "ready" ? "Your go-ahead" : undefined },
    { key: "learn", label: "Learn", state: (a.learnings ?? []).length ? "done" : live ? "running" : "waiting", detail: (a.learnings ?? []).length ? `${a.learnings!.length} read${a.learnings!.length > 1 ? "s" : ""}` : undefined },
    { key: "update", label: "Update", state: pending ? "attention" : (a.moves ?? []).some((m) => m.status === "done" && m.kind !== "go_live") ? "done" : "waiting", detail: pending ? `${pending} to approve` : undefined },
  ];
}

export function Autopilot({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["autopilot", id], queryFn: () => autopilot.get(id),
    refetchInterval: (s) => { const d = s.state.data; return !d || ["reading", "crafting", "launching"].includes(d.status) || (d.moves ?? []).some((m) => m.status === "running") ? 2500 : 30_000; },
  });
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["autopilot", id] });
  const check = useMutation({ mutationFn: () => autopilot.check(id), onSuccess: () => { refresh(); toast("Read the latest results"); }, onError: (e) => toast(e instanceof Error ? e.message : String(e), "error") });
  const stop = useMutation({ mutationFn: (s: boolean) => autopilot.stop(id, s), onSuccess: refresh });
  const retry = useMutation({ mutationFn: () => autopilot.retry(id), onSuccess: refresh });
  if (q.isLoading) return <Skeleton className="h-[520px]" />;
  if (q.isError || !q.data) return <ErrorNote error={q.error ?? "not found"} />;
  const a = q.data;
  const st = AUTOPILOT_STATUS[a.status] ?? { label: a.status, tone: "neutral" as const };
  const working = ["reading", "crafting", "launching"].includes(a.status);
  const canWrite = a.role !== "viewer";
  return (
    <div>
      <Link to="/create" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><IconChevron size={14} className="rotate-180" /> Create</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <BrandMark a={a} size={56} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[28px] leading-tight font-semibold md:text-[32px]">{a.profile?.brand.name ?? host(a.url)}</h1>
              <Pill tone={st.tone}>{working && <Spinner className="h-3 w-3" />}{st.label}</Pill>
            </div>
            <a href={a.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[14px] text-ink-2 hover:text-accent"><IconLink size={13} />{host(a.url)}</a>
          </div>
        </div>
        {canWrite && (a.status === "live" || a.status === "stopped") && (
          <div className="flex gap-2">
            {a.status === "live" && <Button icon={<IconRefresh size={15} />} loading={check.isPending} onClick={() => check.mutate()}>Check results now</Button>}
            <Button variant="plain" loading={stop.isPending} onClick={() => stop.mutate(a.status === "live")}>{a.status === "live" ? "Pause autopilot" : "Resume autopilot"}</Button>
          </div>
        )}
      </div>

      <StageRail a={a} />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {a.status === "failed" && (
            <Card className="p-5">
              <h2 className="text-[17px] font-semibold">The agent hit a problem</h2>
              <p className="mt-1 text-[14px] text-ink-2">{a.error ?? "Nothing was launched."}</p>
              {canWrite && <div className="mt-4"><Button variant="primary" icon={<IconRefresh size={15} />} loading={retry.isPending} onClick={() => retry.mutate()}>Try again</Button></div>}
            </Card>
          )}
          {working && a.status !== "launching" && <Working a={a} />}
          {a.status === "ready" && <LaunchCard a={a} />}
          {(a.status === "live" || a.status === "stopped") && <><Moves a={a} /><Performance a={a} /><Learnings a={a} /></>}
          {a.project?.designs.length && a.status !== "ready" ? <Campaign a={a} /> : null}
        </div>
        <div className="min-w-0 space-y-6">
          {a.profile && <BrandCard a={a} />}
          <Log a={a} />
        </div>
      </div>
    </div>
  );
}

function BrandMark({ a, size }: { a: { site: AutopilotDetail["site"]; profile: AutopilotDetail["profile"]; url: string }; size: number }) {
  const logo = a.site?.logoRef;
  return (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-2xl border hairline bg-white" style={{ width: size, height: size }}>
      {logo ? <img src={mediaUrl(logo)} alt="" className="h-full w-full object-contain p-2" /> : <span className="text-[20px] font-semibold text-ink-2">{(a.profile?.brand.name ?? host(a.url)).slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}

function StageRail({ a }: { a: AutopilotDetail }) {
  return (
    <Card className="overflow-x-auto scroll-thin p-2">
      <ol className="flex min-w-[640px]">
        {stages(a).map((s, i) => (
          <li key={s.key} className="flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5">
            <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold",
              s.state === "done" ? "bg-ok text-white" : s.state === "running" ? "bg-accent/15 text-accent" : s.state === "attention" ? "bg-medium/20 text-[var(--medium)]" : "border-[1.5px] border-[var(--line)] text-ink-3")}>
              {s.state === "done" ? <IconCheck size={14} strokeWidth={2.5} /> : s.state === "running" ? <Spinner className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <div className="min-w-0">
              <div className={cx("text-[14px] font-medium", s.state === "waiting" && "text-ink-2")}>{s.label}</div>
              <div className="truncate text-[12px] text-ink-2">{s.detail ?? (s.state === "running" ? "Working…" : " ")}</div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Working({ a }: { a: AutopilotDetail }) {
  const steps = a.project?.steps ?? [];
  return (
    <Card className="p-6">
      <h2 className="text-[20px] font-semibold">{a.status === "reading" ? "Reading your website" : "Making your campaign"}</h2>
      <p className="mt-1 mb-5 text-[14px] text-ink-2">A few minutes. You can leave; the agent keeps going and asks before anything spends money.</p>
      <ol className="space-y-3.5">
        <StepLine label="Read the site: brand, products, prices, photos, voice" status={a.profile ? "done" : "running"} detail={a.profile ? `${a.profile.brand.name} · ${a.site?.products.length ?? 0} products · leading with ${a.project?.brief.productName ?? "…"}` : undefined} />
        {steps.map((s) => <StepLine key={s.key} label={s.label} status={s.status} detail={s.detail} />)}
      </ol>
    </Card>
  );
}
function StepLine({ label, status, detail }: { label: string; status: string; detail?: string }) {
  return (
    <li className="flex gap-3">
      <span className={cx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full", status === "done" ? "bg-ok text-white" : status === "failed" ? "bg-critical text-white" : status === "running" ? "bg-accent/15 text-accent" : "border-[1.5px] border-[var(--line)]")}>
        {status === "done" ? <IconCheck size={14} strokeWidth={2.5} /> : status === "failed" ? <IconX size={14} strokeWidth={2.5} /> : status === "running" ? <Spinner className="h-3.5 w-3.5" /> : null}
      </span>
      <div className="min-w-0">
        <div className={cx("font-medium", status === "waiting" && "text-ink-2")}>{label}</div>
        {detail && <div className="text-[13px] text-ink-2">{detail}</div>}
      </div>
    </li>
  );
}

function LaunchCard({ a }: { a: AutopilotDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const go = useMutation({
    mutationFn: (live: boolean) => autopilot.launch(a.id, live),
    onSuccess: (_d, live) => { void qc.invalidateQueries({ queryKey: ["autopilot", a.id] }); toast(live ? "Launched and switched on" : "Launched paused"); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const p = a.project!;
  const picked = p.designs.filter((d) => d.picked);
  const owner = a.role === "owner";
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold">Ready to launch</h2>
          <p className="mt-1 max-w-xl text-[14px] text-ink-2">
            {picked.length} ads, one per direction, in a new campaign: {p.brief.countries.join(", ")}, ages {p.brief.ageMin}–{p.brief.ageMax}, {a.settings.dailyBudget.toLocaleString()} a day. Meta's AI enhancements are locked off, and Keel watches every ad from its first minute.
          </p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {picked.map((d) => (
          <figure key={d.id} className="min-w-0">
            <img src={mediaUrl(d.renderRef)} alt="" className="aspect-[4/5] w-full rounded-xl border hairline object-cover" />
            <figcaption className="mt-1.5 truncate text-[13px] font-medium">{p.directions[d.direction]?.title}</figcaption>
          </figure>
        ))}
      </div>
      {go.isError && <div className="mt-4"><ErrorNote error={go.error} /></div>}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" icon={<IconPlay size={15} />} disabled={!owner} loading={go.isPending && go.variables === true} onClick={() => go.mutate(true)}>Launch and switch on</Button>
        <Button size="lg" disabled={!owner} loading={go.isPending && go.variables === false} onClick={() => go.mutate(false)}>Launch paused</Button>
        <span className="text-[13px] text-ink-2">{owner ? "Paused means nothing spends until you approve switching it on." : "Only an owner of this ad account can launch."}</span>
      </div>
    </Card>
  );
}

const MOVE_ICON: Record<Move["kind"], string> = { go_live: "▶", pause_ad: "❚❚", scale_budget: "↑", new_variant: "✦" };

function Moves({ a }: { a: AutopilotDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) => autopilot.decide(a.id, v.id, v.approve),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ["autopilot", a.id] }); toast(v.approve ? "Approved. Working on it" : "Dismissed"); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const moves = [...(a.moves ?? [])].reverse();
  const open = moves.filter((m) => m.status === "pending" || m.status === "running");
  const past = moves.filter((m) => m.status !== "pending" && m.status !== "running").slice(0, 6);
  if (!moves.length) return null;
  return (
    <section>
      <SectionTitle>{open.length ? "Waiting for you" : "Changes"}</SectionTitle>
      <div className="space-y-3">
        {open.map((m) => (
          <Card key={m.id} className="animate-enter p-5">
            <div className="flex gap-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/12 text-[13px] font-semibold text-accent">{MOVE_ICON[m.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{m.title}</div>
                <p className="mt-0.5 text-[14px] text-ink-2">{m.why}</p>
                {m.kind === "new_variant" && m.params.idea && (
                  <div className="mt-3 rounded-xl bg-fill px-4 py-3 text-[14px]">
                    <div className="font-medium">"{m.params.idea.headline}"</div>
                    <div className="text-ink-2">{m.params.idea.subline}</div>
                    <div className="mt-1 text-[12px] text-ink-3">Scene: {m.params.idea.scenePrompt}</div>
                  </div>
                )}
                {a.role !== "viewer" && (
                  <div className="mt-4 flex gap-2">
                    {m.status === "running" ? <Pill tone="accent"><Spinner className="h-3 w-3" />Working</Pill> : <>
                      <Button variant="primary" icon={<IconCheck size={15} />} loading={decide.isPending && decide.variables?.id === m.id && decide.variables.approve} onClick={() => decide.mutate({ id: m.id, approve: true })}>Approve</Button>
                      <Button variant="plain" loading={decide.isPending && decide.variables?.id === m.id && !decide.variables.approve} onClick={() => decide.mutate({ id: m.id, approve: false })}>Dismiss</Button>
                    </>}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
        {past.length > 0 && (
          <Card className="divide-y hairline">
            {past.map((m) => (
              <div key={m.id} className="flex items-start gap-3 px-5 py-3 text-[14px]">
                <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", m.status === "done" ? "bg-ok text-white" : m.status === "failed" ? "bg-critical text-white" : "bg-fill text-ink-3")}>
                  {m.status === "done" ? <IconCheck size={12} strokeWidth={2.5} /> : <IconX size={12} strokeWidth={2.5} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cx(m.status === "dismissed" && "text-ink-2")}>{m.title}</div>
                  {m.result && <div className={cx("text-[13px]", m.status === "failed" ? "text-critical" : "text-ink-2")}>{m.result}</div>}
                </div>
                <span className="shrink-0 text-[12px] text-ink-3">{relTime(m.decidedAt ?? m.createdAt)}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </section>
  );
}

function Performance({ a }: { a: AutopilotDetail }) {
  const snaps = a.performance ?? [];
  const last = snaps.at(-1);
  const launch = a.project?.launch;
  const next = a.nextCheckAt ? new Date(a.nextCheckAt) : null;
  return (
    <section>
      <SectionTitle action={<span className="text-[13px] text-ink-2">{last ? `Checked ${relTime(last.at)}` : "Not checked yet"}{a.status === "live" && next ? ` · next ${next > new Date() ? `in ${Math.max(1, Math.round((next.getTime() - Date.now()) / 3_600_000))} h` : "soon"}` : ""}</span>}>Results</SectionTitle>
      <Card className="p-5">
        {!last || !last.totals.impressions ? (
          <div className="text-[14px] text-ink-2">
            {launch?.active ? "No delivery yet. Meta reviews new ads first, which usually takes under a day." : "The campaign is paused. Approve switching it on, and the agent starts learning from the first results."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[["Impressions", last.totals.impressions.toLocaleString()], ["Link clicks", last.totals.clicks.toLocaleString()], ["CTR", `${last.totals.ctr.toFixed(2)}%`], ["Spent", money(last.totals.spend, last.currency)]].map(([k, v]) => (
                <div key={k}><div className="text-[12px] text-ink-2">{k}</div><div className="text-[22px] font-semibold tabular-nums">{v}</div></div>
              ))}
            </div>
            <div className="mt-5 overflow-x-auto scroll-thin">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead><tr className="text-left text-[12px] text-ink-2"><th className="pb-2 font-medium">Direction</th><th className="pb-2 font-medium">CTR</th><th className="pb-2 text-right font-medium">Impr.</th><th className="pb-2 text-right font-medium">Clicks</th><th className="pb-2 text-right font-medium">CPC</th><th className="pb-2 text-right font-medium">Spent</th>{last.ads.some((x) => x.purchases) && <><th className="pb-2 text-right font-medium">Sales</th><th className="pb-2 text-right font-medium">Cost/sale</th><th className="pb-2 text-right font-medium">ROAS</th></>}</tr></thead>
                <tbody>
                  {[...last.ads].sort((x, y) => y.ctr - x.ctr).map((ad) => {
                    const best = Math.max(...last.ads.map((x) => x.ctr), 0.01);
                    const winner = a.learnings?.at(-1)?.winner === ad.direction;
                    return (
                      <tr key={ad.adId} className="border-t hairline">
                        <td className="py-2.5 pr-3"><div className="flex items-center gap-2"><span className={cx("font-medium", ad.status !== "ACTIVE" && "text-ink-2")}>{ad.title}</span>{winner && <Pill tone="ok">Winning</Pill>}{ad.status !== "ACTIVE" && <Pill>{ad.status.toLowerCase().replaceAll("_", " ")}</Pill>}</div></td>
                        <td className="w-[30%] py-2.5 pr-3"><div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${(ad.ctr / best) * 100}%` }} /></div><span className="w-12 text-right tabular-nums">{ad.ctr.toFixed(2)}%</span></div></td>
                        <td className="py-2.5 text-right tabular-nums">{ad.impressions.toLocaleString()}</td>
                        <td className="py-2.5 text-right tabular-nums">{ad.clicks.toLocaleString()}</td>
                        <td className="py-2.5 text-right tabular-nums">{ad.cpc ? money(ad.cpc, last.currency) : "–"}</td>
                        <td className="py-2.5 text-right tabular-nums">{money(ad.spend, last.currency)}</td>
                        {last.ads.some((x) => x.purchases) && <>
                          <td className="py-2.5 text-right tabular-nums">{ad.purchases ?? 0}</td>
                          <td className="py-2.5 text-right tabular-nums">{ad.cpa ? money(ad.cpa, last.currency) : "–"}</td>
                          <td className="py-2.5 text-right tabular-nums">{ad.roas ? `${ad.roas.toFixed(1)}x` : "–"}</td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {launch && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t hairline pt-3 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-1"><IconLock size={13} /> AI enhancements locked off</span>
            <span>{a.settings.dailyBudget.toLocaleString()} a day (cap {a.settings.maxDailyBudget.toLocaleString()})</span>
            <a className="text-accent" href={adsManagerUrl(a.accountId, launch.campaignId)} target="_blank" rel="noreferrer">Open in Ads Manager</a>
          </div>
        )}
      </Card>
    </section>
  );
}

function Learnings({ a }: { a: AutopilotDetail }) {
  const ls = [...(a.learnings ?? [])].reverse();
  if (!ls.length) return null;
  return (
    <section>
      <SectionTitle>What it learned</SectionTitle>
      <Card className="p-5">
        <ol className="space-y-5">
          {ls.slice(0, 6).map((l, i) => (
            <li key={l.at} className={cx("relative pl-5", i > 0 && "opacity-80")}>
              <span className={cx("absolute top-1.5 left-0 h-2 w-2 rounded-full", i === 0 ? "bg-accent" : "bg-[var(--line)]")} />
              <div className="text-[12px] text-ink-3">{relTime(l.at)} · {l.impressions.toLocaleString()} impressions · {l.confidence} confidence</div>
              <p className="mt-0.5 text-[15px]">{l.summary}</p>
              {l.learnings.length > 0 && <ul className="mt-2 space-y-1 text-[14px] text-ink-2">{l.learnings.map((x) => <li key={x} className="flex gap-2"><IconCheck size={14} className="mt-0.5 shrink-0 text-ok" />{x}</li>)}</ul>}
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

function Campaign({ a }: { a: AutopilotDetail }) {
  const p = a.project!;
  const ads = new Set((p.launch?.ads ?? []).map((x) => x.direction));
  return (
    <section>
      <SectionTitle action={<Link to="/create/$id" params={{ id: p.id }} className="inline-flex items-center gap-1 text-[14px] text-accent">Designs, research and storyboard <IconArrowRight size={14} /></Link>}>The campaign</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {p.designs.map((d) => {
          const dir = p.directions[d.direction];
          return (
            <Card key={d.id} className="overflow-hidden">
              <img src={mediaUrl(d.renderRef)} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover" />
              <div className="p-4">
                <div className="flex items-center justify-between gap-2"><div className="truncate font-semibold">{dir?.title}</div>{ads.has(d.direction) ? <Pill tone="ok">Live ad</Pill> : d.picked ? <Pill>Picked</Pill> : null}</div>
                {dir?.rationale && <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{dir.rationale}</p>}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function BrandCard({ a }: { a: AutopilotDetail }) {
  const pr = a.profile!;
  const site = a.site;
  const hero = a.project?.brief.productName;
  return (
    <Card className="overflow-hidden">
      {site?.screenshotRef && <img src={mediaUrl(site.screenshotRef)} alt="" className="aspect-[16/9] w-full border-b hairline object-cover object-top" />}
      <div className="space-y-4 p-5">
        <div>
          <div className="text-[12px] font-medium text-ink-3 uppercase">What it read about your brand</div>
          <p className="mt-1 text-[15px] font-medium">{pr.brand.oneLiner}</p>
          {pr.brand.voice && <p className="mt-1 text-[14px] text-ink-2">Voice: {pr.brand.voice}</p>}
        </div>
        <div className="flex items-center gap-2">
          {[pr.brand.palette.base, pr.brand.palette.accent, pr.brand.palette.ink].map((c) => <span key={c} title={c} className="h-7 w-7 rounded-full border hairline" style={{ background: c }} />)}
          {site?.fonts[0] && <span className="ml-2 truncate text-[13px] text-ink-2">{site.fonts.slice(0, 2).join(" · ")}</span>}
        </div>
        <div className="text-[14px]">
          <div className="text-[12px] font-medium text-ink-3 uppercase">Audience</div>
          <p className="mt-0.5">{pr.audience.summary}</p>
          <p className="text-ink-2">Ages {pr.audience.ageMin}–{pr.audience.ageMax} · {pr.audience.countries.join(", ")}</p>
        </div>
        {site && site.products.length > 0 && (
          <div>
            <div className="mb-2 text-[12px] font-medium text-ink-3 uppercase">Products found</div>
            <div className="grid grid-cols-3 gap-2">
              {site.products.slice(0, 6).map((p) => (
                <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="group min-w-0" title={p.name}>
                  <div className={cx("relative overflow-hidden rounded-lg border bg-white", p.name === hero ? "border-accent ring-2 ring-accent/30" : "hairline")}>
                    <img src={mediaUrl(p.imageRefs[0] ?? null)} alt="" className="aspect-square w-full object-contain" />
                    {p.name === hero && <span className="absolute top-1 left-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">Lead</span>}
                  </div>
                  <div className="mt-1 truncate text-[12px]">{p.name}</div>
                </a>
              ))}
            </div>
            {pr.heroWhy && <p className="mt-2 text-[13px] text-ink-2">{pr.heroWhy}</p>}
          </div>
        )}
        {pr.competitors.length > 0 && <p className="text-[13px] text-ink-2"><span className="text-ink">Competitors to study:</span> {pr.competitors.join(", ")}</p>}
      </div>
    </Card>
  );
}

const STAGE_NAME: Record<string, string> = { site: "Site", research: "Research", strategy: "Strategy", scenes: "Art direction", compose: "Layout", check: "Check", storyboard: "Storyboard", craft: "Craft", launch: "Launch", learn: "Learn", update: "Update" };

function Log({ a }: { a: AutopilotDetail }) {
  const entries = [...(a.log ?? []).map((e) => ({ ...e, step: e.stage })), ...(a.project?.log ?? [])].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 80);
  const live = ["reading", "crafting", "launching"].includes(a.status);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold"><IconSparkle size={16} className="text-accent" />Agent log</h2>
        {live && <span className="flex items-center gap-1.5 text-[12px] text-ink-2"><span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" /> live</span>}
      </div>
      {!entries.length ? <p className="text-[14px] text-ink-2">Starting…</p> : (
        <ol className="max-h-[60vh] space-y-2.5 overflow-auto scroll-thin">
          {entries.map((e, i) => (
            <li key={`${e.at}${i}`} className="flex gap-3 text-[13px]">
              <span className="w-20 shrink-0 leading-5 text-ink-3">{STAGE_NAME[e.step] ?? e.step}</span>
              <span className={cx("min-w-0 leading-5", e.kind === "decision" ? "font-medium text-ink" : e.kind === "warn" ? "text-high" : "text-ink-2")}>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
