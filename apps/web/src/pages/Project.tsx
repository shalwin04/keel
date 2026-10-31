import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { adsManagerUrl, api, mediaUrl, studio, type StudioDesign, type StudioDirection, type StudioProjectDetail } from "../api.ts";
import { IconArrowRight, IconCheck, IconChevron, IconLink, IconLock, IconRefresh, IconSparkle, IconX } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, ErrorNote, Pill, Segmented, Skeleton, Spinner, cx } from "../components/ui.tsx";

const SIZE_LABEL = { square: "1:1 Feed", portrait: "4:5 Feed", story: "9:16 Stories" } as const;
const ORDER = ["square", "portrait", "story"] as const;

export function Project({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["studio", "project", id], queryFn: () => studio.project(id),
    refetchInterval: (s) => (s.state.data && ["drafting", "launching"].includes(s.state.data.status) ? 2000 : false),
  });
  if (q.isLoading) return <Skeleton className="h-[480px]" />;
  if (q.isError || !q.data) return <ErrorNote error={q.error ?? "not found"} />;
  const p = q.data;
  return (
    <div>
      <Link to="/create" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><IconChevron size={14} className="rotate-180" /> Create</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-semibold md:text-[32px]">{p.name}</h1>
          <p className="mt-1 text-ink-2">{p.brief.productName} · {p.brief.countries.join(", ")} · ages {p.brief.ageMin}–{p.brief.ageMax} · {p.brief.dailyBudget}/day</p>
        </div>
      </div>
      {p.status === "drafting" || (p.status === "failed" && !p.designs.length) ? <Progress p={p} /> : <Board p={p} />}
    </div>
  );
}

function Progress({ p }: { p: StudioProjectDetail }) {
  const qc = useQueryClient();
  const retry = useMutation({ mutationFn: () => studio.retry(p.id), onSuccess: () => void qc.invalidateQueries({ queryKey: ["studio", "project", p.id] }) });
  return (
    <Card className="max-w-2xl p-6">
      <h2 className="mb-1 text-[20px] font-semibold">{p.status === "failed" ? "The agent hit a problem" : "Keel is making your ads"}</h2>
      <p className="mb-6 text-[14px] text-ink-2">{p.status === "failed" ? "Nothing was launched. Try again, or change the brief." : "This takes a minute or two. You can leave this page; it keeps going."}</p>
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
