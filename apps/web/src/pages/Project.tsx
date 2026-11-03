import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FORMAT_LABEL, FORMATS, type FormatKey } from "@keel/core/studio";
import { adsManagerUrl, api, mediaUrl, studio, type Concept, type StudioDesign, type StudioDirection, type StudioProjectDetail } from "../api.ts";
import { IconArrowRight, IconCheck, IconChevron, IconLink, IconLock, IconRefresh, IconSparkle, IconX } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, ErrorNote, Pill, Segmented, Skeleton, Spinner, cx } from "../components/ui.tsx";

const SIZE_LABEL = { square: "1:1 Feed", portrait: "4:5 Feed", story: "9:16 Stories" } as const;
const ORDER = ["square", "portrait", "story"] as const;

type Tab = "designs" | "concepts" | "research" | "storyboard" | "log";

export function Project({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["studio", "project", id], queryFn: () => studio.project(id),
    refetchInterval: (s) => (s.state.data && (["drafting", "launching"].includes(s.state.data.status) || s.state.data.concepts?.status === "making") ? 2000 : false),
  });
  const [tab, setTab] = useState<Tab>("designs");
  if (q.isLoading) return <Skeleton className="h-[480px]" />;
  if (q.isError || !q.data) return <ErrorNote error={q.error ?? "not found"} />;
  const p = q.data;
  const drafting = p.status === "drafting" || (p.status === "failed" && !p.designs.length);
  return (
    <div>
      <Link to="/create" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><IconChevron size={14} className="rotate-180" /> Create</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-semibold md:text-[32px]">{p.name}</h1>
          <p className="mt-1 text-ink-2">{p.brief.productName} · {p.brief.countries.join(", ")} · ages {p.brief.ageMin}–{p.brief.ageMax} · {p.brief.dailyBudget}/day</p>
        </div>
        {!drafting && (
          <Segmented label="View" value={tab} onChange={setTab} options={[
            { value: "designs", label: "Designs" }, { value: "concepts", label: "Concepts" }, { value: "research", label: "Research" }, { value: "storyboard", label: "Storyboard" }, { value: "log", label: "Agent log" },
          ]} />
        )}
      </div>
      {drafting ? <Progress p={p} /> : tab === "designs" ? <Board p={p} /> : tab === "concepts" ? <ConceptsView p={p} /> : tab === "research" ? <ResearchView p={p} onRemix={() => setTab("concepts")} /> : tab === "storyboard" ? <StoryboardView p={p} /> : <AgentLog p={p} />}
    </div>
  );
}

function Progress({ p }: { p: StudioProjectDetail }) {
  const qc = useQueryClient();
  const retry = useMutation({ mutationFn: () => studio.retry(p.id), onSuccess: () => void qc.invalidateQueries({ queryKey: ["studio", "project", p.id] }) });
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <Card className="h-fit p-6">
        <h2 className="mb-1 text-[20px] font-semibold">{p.status === "failed" ? "The agent hit a problem" : "Keel's agent is at work"}</h2>
        <p className="mb-6 text-[14px] text-ink-2">{p.status === "failed" ? p.error ?? "Nothing was launched. Try again, or change the brief." : "A few minutes. You can leave; it keeps going."}</p>
        <ol className="space-y-4">
          {p.steps.map((s) => (
            <li key={s.key} className="flex gap-3">
              <span className={cx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                s.status === "done" ? "bg-ok text-white" : s.status === "failed" ? "bg-critical text-white" : s.status === "running" ? "bg-accent/15 text-accent" : "border-[1.5px] border-[var(--line)]")}>
                {s.status === "done" ? <IconCheck size={14} strokeWidth={2.5} /> : s.status === "failed" ? <IconX size={14} strokeWidth={2.5} /> : s.status === "running" ? <Spinner className="h-3.5 w-3.5" /> : null}
              </span>
              <div className="min-w-0">
                <div className={cx("font-medium", s.status === "waiting" && "text-ink-2")}>{s.label}</div>
                {s.detail && <div className={cx("text-[13px]", s.status === "failed" ? "text-critical" : "text-ink-2")}>{s.detail}{s.ms ? ` · ${(s.ms / 1000).toFixed(1)} s` : ""}</div>}
              </div>
            </li>
          ))}
        </ol>
        {p.status === "failed" && <div className="mt-6"><Button variant="primary" icon={<IconRefresh size={15} />} loading={retry.isPending} onClick={() => retry.mutate()}>Try again</Button></div>}
      </Card>
      <AgentLog p={p} live />
    </div>
  );
}

const STEP_NAME: Record<string, string> = { research: "Research", strategy: "Strategy", scenes: "Art direction", compose: "Layout", check: "Check", storyboard: "Storyboard" };

function AgentLog({ p, live }: { p: StudioProjectDetail; live?: boolean }) {
  const entries = [...(p.log ?? [])].reverse();
  return (
    <Card className="h-fit p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">What the agent found and decided</h2>
        {live && p.status === "drafting" && <span className="flex items-center gap-1.5 text-[12px] text-ink-2"><span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" /> live</span>}
      </div>
      {!entries.length ? <p className="text-[14px] text-ink-2">Starting…</p> : (
        <ol className="max-h-[70vh] space-y-2.5 overflow-auto scroll-thin">
          {entries.map((e, i) => (
            <li key={`${e.at}${i}`} className={cx("flex gap-3 text-[14px]", i === 0 && live && "animate-enter")}>
              <span className="w-24 shrink-0 text-[12px] leading-5 text-ink-3">{STEP_NAME[e.step] ?? e.step}</span>
              <span className={cx("min-w-0", e.kind === "decision" ? "font-medium text-ink" : e.kind === "warn" ? "text-high" : "text-ink-2")}>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ResearchView({ p, onRemix }: { p: StudioProjectDetail; onRemix: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const remix = useMutation({
    mutationFn: (adId: string) => studio.makeConcepts(p.id, { remixOf: adId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["studio", "project", p.id] }); toast("Remixing that ad's structure for your brand"); onRemix(); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const r = p.research;
  if (!r) return <Card className="p-6 text-ink-2">No research for this campaign.</Card>;
  const ins = r.insights;
  const byId = new Map(r.ads.map((a) => [a.id, a]));
  return (
    <div className="space-y-8">
      <Card className="p-6">
        <p className="text-[12px] font-semibold text-ink-2">{[
          r.ads.filter((a) => a.source === "ad_library").length && `${r.ads.filter((a) => a.source === "ad_library").length} ads`,
          r.ads.filter((a) => a.source === "site").length && `${r.ads.filter((a) => a.source === "site").length} web pages`,
          r.ads.filter((a) => a.source === "upload").length && `${r.ads.filter((a) => a.source === "upload").length} uploaded`,
          `${new Set(r.ads.filter((a) => a.source !== "upload").map((a) => a.pageName)).size} competitors`,
          r.searchTerms.length && `searched ${r.searchTerms.join(", ")}`,
        ].filter(Boolean).join(" · ")}</p>
        <p className="mt-2 text-[17px] leading-relaxed">{ins.summary}</p>
        {r.note && <p className="mt-3 text-[13px] text-ink-2">{r.note}</p>}
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-3 text-[13px] font-semibold text-ink-2">What everyone does</h3>
          <ul className="space-y-3">
            {ins.patterns.map((pt) => (
              <li key={pt.label}>
                <div className="flex items-baseline justify-between gap-2"><span className="font-medium">{pt.label}</span>{pt.count > 0 && <span className="text-[12px] text-ink-3">{pt.count} seen</span>}</div>
                {pt.detail && <p className="text-[13px] text-ink-2">{pt.detail}</p>}
                {pt.examples.length > 0 && (
                  <div className="mt-1.5 flex gap-1.5">
                    {pt.examples.map((id) => byId.get(id)?.snapshotRef && <img key={id} src={mediaUrl(byId.get(id)!.snapshotRef!)} alt="" className="h-10 w-8 rounded object-cover object-top" />)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 text-[13px] font-semibold text-ink-2">Overused</h3>
          <ul className="space-y-2 text-[14px]">{ins.saturated.map((x) => <li key={x} className="flex gap-2"><IconX size={15} className="mt-0.5 shrink-0 text-ink-3" />{x}</li>)}</ul>
          <h3 className="mt-5 mb-3 text-[13px] font-semibold text-ink-2">Open space for you</h3>
          <ul className="space-y-2 text-[14px]">{ins.whiteSpace.map((x) => <li key={x} className="flex gap-2"><IconCheck size={15} className="mt-0.5 shrink-0 text-ok" />{x}</li>)}</ul>
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 text-[13px] font-semibold text-ink-2">Recommendations</h3>
          <ol className="list-decimal space-y-2 pl-4 text-[14px]">{ins.recommendations.map((x) => <li key={x}>{x}</li>)}</ol>
        </Card>
      </div>
      {r.voice && <VoiceView voice={r.voice} />}
      <div>
        <h3 className="mb-3 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-2 uppercase">What the agent studied</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {r.ads.map((a, i) => (
            <Card key={a.id} className="animate-enter overflow-hidden" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
              <div className="aspect-[4/5] bg-fill">{a.snapshotRef && <img src={mediaUrl(a.snapshotRef)} alt={`Ad by ${a.pageName}`} loading="lazy" className="h-full w-full object-cover object-top" />}</div>
              <div className="space-y-1.5 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[14px] font-medium">{a.pageName}</span>
                  {a.daysRunning ? <span className="shrink-0 text-[12px] text-ink-3">{a.daysRunning} days</span> : a.source === "upload" ? <span className="text-[12px] text-ink-3">uploaded</span> : a.source === "site" ? <span className="text-[12px] text-ink-3">website</span> : null}
                </div>
                {a.analysis && <p className="line-clamp-2 text-[13px] text-ink-2">{a.analysis.hook}</p>}
                {a.analysis && <div className="flex flex-wrap gap-1"><Pill>{a.analysis.format}</Pill>{a.analysis.emotion && <Pill>{a.analysis.emotion}</Pill>}</div>}
                {a.libraryUrl && <a href={a.libraryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent"><IconLink size={12} /> Ad Library</a>}
                {a.siteUrl && <a href={a.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent"><IconLink size={12} /> Website</a>}
                {a.source === "ad_library" && p.role !== "viewer" && (
                  <button type="button" disabled={remix.isPending || p.concepts?.status === "making"} onClick={() => remix.mutate(a.id)} className="press mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent disabled:opacity-50">
                    <IconSparkle size={12} /> Remix for us
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function StoryboardView({ p }: { p: StudioProjectDetail }) {
  const dirs = p.directions ?? [];
  const [n, setN] = useState(0);
  const qc = useQueryClient();
  const toast = useToast();
  const d = dirs[n];
  const draw = useMutation({
    mutationFn: () => studio.storyboard(p.id, n),
    onSuccess: (r) => { toast(`${r.frames} frames drawn`); void qc.invalidateQueries({ queryKey: ["studio", "project", p.id] }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  if (!d) return null;
  const frames = d.frames ?? [];
  const reel = d.storyboard.reel;
  const total = reel.reduce((t, s) => t + s.seconds, 0);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Direction" value={String(n)} onChange={(v) => setN(Number(v))} options={dirs.map((x, i) => ({ value: String(i), label: x.title }))} />
        {p.role !== "viewer" && reel.length > 0 && (
          <Button size="sm" icon={<IconSparkle size={14} />} loading={draw.isPending} onClick={() => draw.mutate()}>{frames.some(Boolean) ? "Redraw frames" : "Draw the frames"}</Button>
        )}
      </div>

      {d.storyboard.beats.length > 0 && (
        <section>
          <h3 className="mb-3 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-2 uppercase">Campaign story</h3>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(d.storyboard.beats.length, 4)}, minmax(0, 1fr))` }}>
            {d.storyboard.beats.map((b, i) => (
              <Card key={i} className="relative p-4">
                <div className="mb-2 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[12px] font-semibold text-accent-ink">{i + 1}</span><span className="font-semibold">{b.name}</span><span className="ml-auto text-[12px] text-ink-3">{b.when}</span></div>
                <p className="text-[14px] font-medium">"{b.message}"</p>
                <p className="mt-1 text-[13px] text-ink-2">{b.goal}</p>
                <p className="mt-2 text-[13px] text-ink-3">{b.visual}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {reel.length > 0 ? (
        <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div>
            <h3 className="mb-3 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-2 uppercase">Animatic · {total.toFixed(0)} s</h3>
            <Animatic frames={frames} reel={reel} fallback={d.sceneRef} accent={d.palette.accent} />
          </div>
          <div>
            <h3 className="mb-3 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-2 uppercase">Reel shots</h3>
            <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {reel.map((s, i) => (
                <li key={i}>
                  <Card className="overflow-hidden">
                    <div className="relative aspect-[9/12] bg-fill">
                      {frames[i] ? <img src={mediaUrl(frames[i]!)} alt="" className="h-full w-full object-cover" /> : draw.isPending ? <Skeleton className="h-full rounded-none" /> : <div className="grid h-full place-items-center p-4 text-center text-[13px] text-ink-3">{s.visual}</div>}
                      <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">{i + 1} · {s.seconds}s · {s.motion}</span>
                    </div>
                    <div className="p-3">
                      {s.onScreenText && <p className="text-[14px] font-semibold">"{s.onScreenText}"</p>}
                      <p className="mt-0.5 text-[13px] text-ink-2">{s.visual}</p>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : <Card className="p-6 text-ink-2">No Reel planned for this direction.</Card>}
    </div>
  );
}

/** Plays the storyboard as a moving preview: each frame with its camera move and on-screen text, cross-fading in time. */
function Animatic({ frames, reel, fallback, accent }: { frames: (string | null)[]; reel: { seconds: number; onScreenText: string; motion: string }[]; fallback: string; accent: string }) {
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const total = reel.reduce((t, s) => t + s.seconds, 0);
  useEffect(() => {
    if (!playing) return;
    const t0 = performance.now() - at * 1000;
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (t >= total) { setAt(total); setPlaying(false); return; }
      setAt(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  let acc = 0;
  const idx = Math.max(0, reel.findIndex((s) => (acc += s.seconds) > at));
  const start = reel.slice(0, idx).reduce((t, s) => t + s.seconds, 0);
  const local = Math.min(1, (at - start) / (reel[idx]?.seconds || 1));
  const MOVE: Record<string, (k: number) => string> = {
    "push-in": (k) => `scale(${1 + 0.12 * k})`, "pull-out": (k) => `scale(${1.12 - 0.12 * k})`,
    "pan-left": (k) => `scale(1.12) translateX(${4 - 8 * k}%)`, "pan-right": (k) => `scale(1.12) translateX(${-4 + 8 * k}%)`, static: () => "scale(1.02)",
  };
  const shot = reel[idx];
  return (
    <div>
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-black shadow-[var(--shadow-pop)]">
        {reel.map((s, i) => (
          <img key={i} src={mediaUrl(frames[i] ?? fallback)} alt="" className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: i === idx ? 1 : 0, transform: (MOVE[s.motion] ?? MOVE.static!)(i === idx ? local : 0), transition: "opacity 300ms var(--ease-out)" }} />
        ))}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
        {shot?.onScreenText && <p key={idx} className="absolute inset-x-5 bottom-14 animate-enter text-center text-[22px] leading-tight font-bold text-white drop-shadow">{shot.onScreenText}</p>}
        <div className="absolute inset-x-3 top-3 flex gap-1">
          {reel.map((s, i) => <div key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35"><div className="h-full bg-white" style={{ width: `${i < idx ? 100 : i === idx ? local * 100 : 0}%` }} /></div>)}
        </div>
        {!playing && (
          <button aria-label="Play" onClick={() => { if (at >= total) setAt(0); setPlaying(true); }} className="press absolute inset-0 grid place-items-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-black shadow-lg"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z" /></svg></span>
          </button>
        )}
      </div>
      <div className="mt-2 flex justify-between text-[12px] text-ink-3"><span>{at.toFixed(1)} s</span><span style={{ color: accent }}>●</span><span>{total.toFixed(1)} s</span></div>
    </div>
  );
}

function Board({ p }: { p: StudioProjectDetail }) {
  const dirs = p.directions ?? [];
  const launched = p.status === "launched";
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-10">
        {dirs.map((d, i) => <DirectionRow key={i} p={p} d={d} index={i} designs={p.designs.filter((x) => x.direction === i)} readOnly={launched} />)}
      </div>
      <LaunchPanel p={p} />
    </div>
  );
}

function DirectionRow({ p, d, index, designs, readOnly }: { p: StudioProjectDetail; d: StudioDirection; index: number; designs: StudioDesign[]; readOnly: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => qc.invalidateQueries({ queryKey: ["studio", "project", p.id] });
  const picked = designs.some((x) => x.picked);
  const canEdit = !readOnly && p.role !== "viewer";
  const pick = useMutation({ mutationFn: () => studio.saveDesign(designs[0]!.id, { picked: !picked }), onSuccess: refresh });
  const scene = useMutation({ mutationFn: () => studio.newScene(p.id, index), onSuccess: () => { toast("New scene in every size"); void refresh(); }, onError: (e) => toast(e instanceof Error ? e.message : String(e), "error") });
  const useScene = useMutation({ mutationFn: (ref: string) => studio.useScene(p.id, index, ref), onSuccess: refresh });
  const template = useMutation({ mutationFn: (t: string) => studio.template(p.id, index, t), onSuccess: refresh });
  const check = designs.find((x) => x.size === "square")?.check;
  const tmpl = designs[0]?.doc.template ?? "hero";
  const busy = scene.isPending || template.isPending || useScene.isPending;

  return (
    <section className="animate-enter" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 px-1">
        <div className="min-w-0 max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-semibold">{d.title}</h2>
            {check ? (check.pass ? <Pill tone="ok"><IconCheck size={12} /> Checked</Pill> : <Pill tone="medium">Check: {check.issues[0] ?? "needs a look"}</Pill>) : designs.length > 0 && <Pill>Edited by you</Pill>}
            {d.productInScene && <Pill>Your product, placed by Muse Image</Pill>}
          </div>
          <p className="mt-1 text-[14px] text-ink-2">{d.angle}</p>
          {d.rationale && <p className="mt-1 flex gap-1.5 text-[13px] text-accent"><IconSparkle size={13} className="mt-0.5 shrink-0" />{d.rationale}</p>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Layout" value={tmpl} onChange={(t) => template.mutate(t)} options={[{ value: "hero", label: "Hero" }, { value: "split", label: "Split" }, { value: "card", label: "Card" }]} />
            <Button size="sm" icon={busy ? undefined : <IconRefresh size={14} />} loading={scene.isPending} onClick={() => scene.mutate()}>New scene</Button>
            <Button size="sm" variant={picked ? "primary" : "secondary"} icon={picked ? <IconCheck size={14} /> : undefined} loading={pick.isPending} onClick={() => pick.mutate()}>{picked ? "Picked" : "Pick"}</Button>
          </div>
        )}
      </div>

      <div className={cx("grid grid-cols-3 items-end gap-3 transition-opacity duration-200", busy && "opacity-60")}>
        {ORDER.map((size) => {
          const des = designs.find((x) => x.size === size);
          return (
            <figure key={size} className="min-w-0">
              {des?.renderRef ? (
                <Link to="/create/$id/edit/$designId" params={{ id: p.id, designId: des.id }} disabled={!canEdit} className="group relative block">
                  <img src={`${mediaUrl(des.renderRef)}&v=${encodeURIComponent(des.updatedAt)}`} alt={`${d.title}, ${SIZE_LABEL[size]}`} loading="lazy"
                    className={cx("w-full rounded-xl bg-fill shadow-[var(--shadow)] transition-transform duration-200 ease-[var(--ease-out)]", canEdit && "group-hover:-translate-y-0.5", picked && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg)]")}
                    style={{ aspectRatio: `${des.doc.w}/${des.doc.h}` }} />
                  {canEdit && <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2.5 py-1 text-[12px] font-medium text-white opacity-0 backdrop-blur transition-opacity duration-150 group-hover:opacity-100">Edit</span>}
                </Link>
              ) : <Skeleton className="aspect-square" />}
              <figcaption className="mt-1.5 text-[12px] text-ink-2">{SIZE_LABEL[size]}</figcaption>
            </figure>
          );
        })}
      </div>

      {canEdit && (d.sceneHistory?.length ?? 0) > 1 && (
        <div className="mt-3 flex items-center gap-2 px-1">
          <span className="text-[12px] text-ink-2">Scenes</span>
          {d.sceneHistory!.map((ref) => (
            <button key={ref} onClick={() => useScene.mutate(ref)} aria-label="Use this scene"
              className={cx("press h-10 w-10 overflow-hidden rounded-lg bg-fill", ref === d.sceneRef && "ring-2 ring-accent")}>
              <img src={mediaUrl(ref)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <Card className="mt-4 p-4">
        <p className="text-[12px] font-semibold text-ink-2">Ad copy</p>
        <p className="mt-1 text-[14px]">{d.primaryText}</p>
        <p className="mt-2 text-[13px] text-ink-2"><span className="font-medium text-ink">{d.headline}</span> · {d.cta.replaceAll("_", " ").toLowerCase()}</p>
      </Card>
    </section>
  );
}

function LaunchPanel({ p }: { p: StudioProjectDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [confirm, setConfirm] = useState(false);
  const account = me.data?.accounts.find((a) => a.metaAccountId === p.accountId);
  const pickedDirs = [...new Set(p.designs.filter((d) => d.picked).map((d) => d.direction))];
  const launch = useMutation({
    mutationFn: () => studio.launch(p.id),
    onSuccess: () => { toast("Launched, paused. Keel is watching."); void qc.invalidateQueries({ queryKey: ["studio"] }); void qc.invalidateQueries({ queryKey: ["accounts"] }); },
    onError: (e) => { toast("Launch failed", "error"); void e; void qc.invalidateQueries({ queryKey: ["studio", "project", p.id] }); },
  });

  if (p.status === "launched" && p.launch) {
    return (
      <aside className="xl:sticky xl:top-8 xl:self-start">
        <Card className="space-y-4 p-5">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-ok/15 text-ok"><IconCheck size={22} /></div>
          <div>
            <h3 className="text-[18px] font-semibold">Launched, paused</h3>
            <p className="mt-1 text-[14px] text-ink-2">{p.launch.ads.length} ad{p.launch.ads.length === 1 ? "" : "s"} created with AI enhancements switched off. Keel locked their settings as approved and is watching them.</p>
          </div>
          <a href={adsManagerUrl(p.accountId, p.launch.campaignId)} target="_blank" rel="noreferrer" className="block">
            <Button variant="primary" className="w-full" icon={<IconLink size={15} />}>Open in Ads Manager to switch on</Button>
          </a>
          <Link to="/ads" className="block"><Button className="w-full" icon={<IconArrowRight size={15} />}>See them in Ads</Button></Link>
        </Card>
      </aside>
    );
  }

  const canLaunch = account?.role === "owner" && pickedDirs.length > 0;
  return (
    <aside className="xl:sticky xl:top-8 xl:self-start">
      <Card className="space-y-4 p-5">
        <h3 className="text-[18px] font-semibold">Launch</h3>
        <dl className="space-y-2 text-[14px]">
          {[
            ["Account", account?.name ?? p.accountId],
            ["Ads", pickedDirs.length ? `${pickedDirs.length} (one per picked direction)` : "Pick at least one direction"],
            ["Budget", `${p.brief.dailyBudget} a day`],
            ["Dates", `${p.brief.startDate} → ${p.brief.endDate}`],
            ["Audience", `${p.brief.countries.join(", ")} · ${p.brief.ageMin}–${p.brief.ageMax}`],
            ["Destination", p.brief.productUrl.replace(/^https?:\/\//, "")],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4"><dt className="text-ink-2">{k}</dt><dd className="truncate text-right font-medium">{v}</dd></div>
          ))}
        </dl>
        <div className="flex items-start gap-2.5 rounded-xl bg-fill p-3 text-[13px] text-ink-2">
          <IconLock size={16} className="mt-0.5 shrink-0 text-ink" />
          <span>Creates everything <b className="text-ink">paused</b>, with Advantage+ AI enhancements <b className="text-ink">off</b>. Nothing spends until you switch it on in Ads Manager, and Keel flags any setting that changes.</span>
        </div>
        {p.error && <ErrorNote error={p.error} />}
        {!confirm ? (
          <Button variant="primary" size="lg" className="w-full" disabled={!canLaunch} icon={<IconSparkle size={16} />} onClick={() => setConfirm(true)}>Launch {pickedDirs.length || ""} ad{pickedDirs.length === 1 ? "" : "s"}</Button>
        ) : (
          <div className="animate-fade space-y-2">
            <p className="text-[13px] text-ink-2">Create the campaign in {account?.name}? It stays paused.</p>
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" loading={launch.isPending} onClick={() => launch.mutate()}>Yes, launch paused</Button>
              <Button variant="plain" disabled={launch.isPending} onClick={() => setConfirm(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {account && account.role !== "owner" && <p className="text-[13px] text-ink-2">Only owners can launch.</p>}
      </Card>
    </aside>
  );
}

function VoiceView({ voice }: { voice: NonNullable<NonNullable<StudioProjectDetail["research"]>["voice"]> }) {
  return (
    <section>
      <h3 className="mb-3 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-2 uppercase">What customers say</h3>
      <Card className="p-5">
        <p className="text-[15px]">{voice.summary}</p>
        {voice.phrases.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">{voice.phrases.map((x) => <span key={x} className="rounded-full bg-fill px-2.5 py-1 text-[13px]">“{x}”</span>)}</div>
        )}
      </Card>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {voice.personas.map((pe) => (
          <Card key={pe.name} className="p-5">
            <div className="font-semibold">{pe.name}</div>
            <p className="text-[13px] text-ink-2">{pe.who}</p>
            {[["Pains", pe.pains], ["Wants", pe.desires], ["Doubts", pe.objections]].map(([k, xs]) => (xs as string[]).length ? (
              <div key={k as string} className="mt-3">
                <div className="text-[12px] font-medium text-ink-3 uppercase">{k as string}</div>
                <ul className="mt-1 space-y-0.5 text-[14px]">{(xs as string[]).map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            ) : null)}
            {pe.quotes.slice(0, 2).map((q) => <blockquote key={q} className="mt-3 border-l-2 border-accent pl-3 text-[13px] text-ink-2 italic">“{q}”</blockquote>)}
          </Card>
        ))}
      </div>
      <p className="mt-2 px-1 text-[12px] text-ink-3">From {voice.quotes.length} real comments ({[...new Set(voice.quotes.map((q) => q.source))].slice(0, 4).join(", ")}).</p>
    </section>
  );
}

const pct = (x?: number) => `${Math.round((x ?? 0) * 100)}`;

/** The concept board: many formats, each pre-scored by Muse Spark. Pick the ones that go into the campaign. */
function ConceptsView({ p }: { p: StudioProjectDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const board = p.concepts;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [formats, setFormats] = useState<Set<FormatKey>>(new Set());
  const refresh = () => void qc.invalidateQueries({ queryKey: ["studio", "project", p.id] });
  const make = useMutation({ mutationFn: () => studio.makeConcepts(p.id, { formats: formats.size ? [...formats] : undefined }), onSuccess: refresh, onError: (e) => toast(e instanceof Error ? e.message : String(e), "error") });
  const add = useMutation({
    mutationFn: () => studio.addConcepts(p.id, [...picked]),
    onSuccess: (r) => { setPicked(new Set()); refresh(); toast(p.status === "launched" ? `Added ${r.added.length} ads to the live campaign` : `Added ${r.added.length} to the campaign`); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const making = board?.status === "making" || make.isPending;
  const items = board?.items ?? [];
  const canWrite = p.role !== "viewer";
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-[18px] font-semibold">Concept board</h2>
            <p className="mt-1 text-[14px] text-ink-2">Muse Wonder writes ideas across proven formats from the research, what customers say and what has worked for you before. Muse Spark scores each one for scroll-stop, clarity, product and text before anything is spent.</p>
          </div>
          {canWrite && <Button variant="primary" icon={<IconSparkle size={15} />} loading={making} onClick={() => make.mutate()}>{items.length ? "Make more" : "Make concepts"}</Button>}
        </div>
        {canWrite && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {FORMATS.map((f) => (
              <button key={f} type="button" onClick={() => setFormats((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; })}
                className={cx("press rounded-full border px-3 py-1 text-[13px] transition-colors duration-150", formats.has(f) ? "border-accent bg-accent/10 text-accent" : "hairline text-ink-2")}>{FORMAT_LABEL[f]}</button>
            ))}
            <span className="self-center pl-1 text-[12px] text-ink-3">{formats.size ? "Only these formats" : "All formats"}</span>
          </div>
        )}
        {board?.status === "failed" && <p className="mt-3 text-[13px] text-critical">{board.error}</p>}
      </Card>

      {making && !items.length ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}</div>
      ) : !items.length ? null : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {making && Array.from({ length: 2 }, (_, i) => <Skeleton key={`m${i}`} className="aspect-square" />)}
          {items.map((c, i) => <ConceptCard key={c.id} c={c} i={i} picked={picked.has(c.id)} onPick={canWrite && c.addedAs === undefined ? () => setPicked((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; }) : undefined} />)}
        </div>
      )}

      {picked.size > 0 && (
        <div className="sticky bottom-20 z-10 md:bottom-6">
          <Card className="mx-auto flex max-w-xl items-center justify-between gap-3 p-3 pl-5 shadow-[var(--shadow-pop)]">
            <span className="text-[14px]">{picked.size} picked{p.status === "launched" ? " · they go live in the running campaign" : ""}</span>
            <Button variant="primary" loading={add.isPending} onClick={() => add.mutate()}>Add to campaign</Button>
          </Card>
        </div>
      )}
    </div>
  );
}

function ConceptCard({ c, i, picked, onPick }: { c: Concept; i: number; picked: boolean; onPick?: () => void }) {
  const sc = c.score;
  return (
    <Card className={cx("animate-enter overflow-hidden transition-shadow duration-200", picked && "ring-2 ring-accent")} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
      <button type="button" disabled={!onPick} onClick={onPick} className="press relative block w-full text-left disabled:cursor-default">
        <img src={mediaUrl(c.renderRef ?? null)} alt={c.title} loading="lazy" className="aspect-square w-full object-cover" />
        {picked && <span className="absolute right-2 bottom-2 grid h-7 w-7 place-items-center rounded-full bg-accent text-white"><IconCheck size={15} strokeWidth={2.5} /></span>}
      </button>
      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[14px] font-semibold">{c.title}</span>
          {c.addedAs !== undefined ? <Pill tone="ok">In campaign</Pill> : c.recommended ? <Pill tone="accent">Recommended</Pill> : null}
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 whitespace-nowrap text-ink-2">{FORMAT_LABEL[c.format]}</span>
          {sc && <span className={cx("rounded-full px-2 py-0.5 font-semibold tabular-nums", sc.overall >= 0.75 ? "bg-ok/15 text-ok" : "bg-fill text-ink-2")} title="Muse Spark's pre-flight score">{pct(sc.overall)}</span>}
          <span className="truncate">{c.remixOf ? `Remix of ${c.remixOf.pageName}` : c.persona ? `For ${c.persona}` : ""}</span>
        </div>
        {sc && (
          <div className="grid grid-cols-5 gap-1 pt-0.5" title={`Scroll-stop ${pct(sc.scrollStop)} · Clarity ${pct(sc.clarity)} · Product ${pct(sc.product)} · Text ${pct(sc.text)} · Brand ${pct(sc.brand)}`}>
            {([["Stop", sc.scrollStop], ["Clear", sc.clarity], ["Product", sc.product], ["Text", sc.text], ["Brand", sc.brand]] as const).map(([k, v]) => (
              <div key={k}><div className="h-1 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-accent" style={{ width: `${(v ?? 0) * 100}%` }} /></div><div className="mt-0.5 text-[10px] text-ink-3">{k}</div></div>
            ))}
          </div>
        )}
        {sc?.notes && <p className="line-clamp-2 text-[12px] text-ink-2">{sc.notes}</p>}
      </div>
    </Card>
  );
}
