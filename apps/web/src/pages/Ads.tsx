import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, featureLabel, isOn, mediaUrl, type Account, type AdRow } from "../api.ts";
import { IconGrid, IconLock, IconPlay, IconPlus, IconUnlock } from "../components/Icons.tsx";
import { SeverityDot } from "../components/Severity.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, Empty, ErrorNote, PageHeader, Pill, Skeleton, Switch, cx, relTime } from "../components/ui.tsx";

const INTERVALS = [30, 60, 180, 360, 720, 1440];
const fmtInterval = (m: number) => (m < 60 ? `${m} min` : m === 1440 ? "daily" : `${m / 60} h`);

export function Ads() {
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  return (
    <div>
      <PageHeader title="Ads" subtitle="Every watched ad, and whether its AI enhancements still match what you approved."
        actions={<Link to="/settings"><Button icon={<IconPlus size={16} />}>Add account</Button></Link>} />
      {accounts.isLoading ? <Skeleton className="h-80" /> : accounts.isError ? <ErrorNote error={accounts.error} /> : !accounts.data?.length ? (
        <Card><Empty icon={<IconGrid size={26} />} title="No ad accounts yet" action={<Link to="/settings"><Button variant="primary">Connect an account</Button></Link>}>
          Connect a Meta ad account and Keel locks each ad's current settings as the approved baseline.
        </Empty></Card>
      ) : (
        <div className="space-y-10">{accounts.data.map((a) => <AccountSection key={a.metaAccountId} account={a} />)}</div>
      )}
    </div>
  );
}

function AccountSection({ account: a }: { account: Account }) {
  const ads = useQuery({ queryKey: ["ads", a.metaAccountId], queryFn: () => api.ads(a.metaAccountId) });
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const owner = a.role === "owner" && !a.isDemo;
  const patch = useMutation({
    mutationFn: (b: { watching?: boolean; pollIntervalMin?: number }) => api.patchAccount(a.metaAccountId, b),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["accounts"] }); toast("Saved"); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const run = useMutation({
    mutationFn: () => api.runCycle(a.metaAccountId),
    onSuccess: (r) => { toast("Check started"); void navigate({ to: "/activity", search: { cycle: r.cycleId } }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const drifted = (ads.data ?? []).filter((ad) => Object.entries(ad.featuresSpec).some(([k, v]) => isOn(v) && !isOn(ad.baseline?.[k]))).length;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold">{a.name}</h2>
          <p className="text-[13px] text-ink-2">
            {a.metaAccountId} · {a.ads} ads · checked {relTime(a.lastCycle?.startedAt)}
            {drifted > 0 && <span className="text-high"> · {drifted} drifted</span>}
          </p>
        </div>
        {!a.isDemo && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Every
              <select disabled={!owner} value={a.pollIntervalMin} onChange={(e) => patch.mutate({ pollIntervalMin: Number(e.target.value) })}
                className="h-8 rounded-[10px] bg-fill px-2 text-[13px] text-ink disabled:opacity-50">
                {INTERVALS.map((m) => <option key={m} value={m}>{fmtInterval(m)}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Watching <Switch label="Watching" checked={a.watching} disabled={!owner} onChange={(v) => patch.mutate({ watching: v })} />
            </label>
            {a.role !== "viewer" && <Button size="sm" variant="primary" icon={<IconPlay size={12} />} loading={run.isPending} onClick={() => run.mutate()}>Check now</Button>}
          </div>
        )}
      </div>
      {ads.isLoading ? <Skeleton className="h-56" /> : ads.isError ? <ErrorNote error={ads.error} /> : !ads.data?.length ? (
        <Card className="px-5 py-8 text-center text-ink-2">No ads seen yet. They appear after the first check.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{ads.data.map((ad, i) => <AdCard key={ad.adId} ad={ad} index={i} />)}</div>
      )}
    </section>
  );
}

function AdCard({ ad, index }: { ad: AdRow; index: number }) {
  const [open, setOpen] = useState(false);
  const rows = Object.entries(ad.featuresSpec).map(([k, v]) => {
    const was = ad.baseline?.[k];
    const state = isOn(v) && !isOn(was) ? "drift" : isOn(v) ? "on" : "off";
    return { k, v, state };
  }).sort((a, b) => ["drift", "on", "off"].indexOf(a.state) - ["drift", "on", "off"].indexOf(b.state));
  const drift = rows.filter((r) => r.state === "drift");
  const visible = open ? rows : rows.slice(0, 4);
  const img = mediaUrl(ad.originalRef);

  return (
    <Card className="flex animate-enter flex-col overflow-hidden" style={{ animationDelay: `${Math.min(index, 9) * 35}ms` }}>
      <div className="relative aspect-[16/10] bg-fill">
        {img ? <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[13px] text-ink-3">No image</div>}
        <div className="absolute top-3 left-3 flex gap-1.5">
          {drift.length > 0 ? <Pill tone="high" className="bg-white/90 text-high dark:bg-black/60">{drift.length} drifted</Pill> : <Pill tone="ok" className="bg-white/90 dark:bg-black/60">Matches approval</Pill>}
        </div>
        {ad.openFindings.length > 0 && (
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 dark:bg-black/60">
            {ad.openFindings.slice(0, 4).map((s, i) => <SeverityDot key={i} severity={s} />)}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold">{ad.adName}</h3>
          <span className="shrink-0 text-[12px] text-ink-3 capitalize">{ad.status.toLowerCase().replaceAll("_", " ")}</span>
        </div>
        {rows.length === 0 ? <p className="mt-2 text-[13px] text-ink-2">No Advantage+ enhancements on this creative.</p> : (
          <ul className="mt-3 space-y-1.5">
            {visible.map((r) => (
              <li key={r.k} className="flex items-center gap-2 text-[13px]">
                <span className={cx("shrink-0", r.state === "drift" ? "text-high" : r.state === "off" ? "text-ink-3" : "text-ink-2")}>
                  {r.state === "off" ? <IconLock size={14} /> : <IconUnlock size={14} />}
                </span>
                <span className={cx("min-w-0 flex-1 truncate", r.state === "off" && "text-ink-2")}>{featureLabel(r.k)}</span>
                <span className={cx("text-[12px] font-medium", r.state === "drift" ? "text-high" : r.state === "on" ? "text-ink-2" : "text-ink-3")}>
                  {r.state === "drift" ? "On · not approved" : r.state === "on" ? "On" : "Off"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 4 && <button className="mt-2 self-start text-[13px] text-accent" onClick={() => setOpen((v) => !v)}>{open ? "Show less" : `All ${rows.length} settings`}</button>}
        <p className="mt-auto pt-3 text-[12px] text-ink-3">
          {ad.changedByKeel ? "Fixed by Keel · " : ""}{ad.variants > 0 ? `${ad.variants} variant${ad.variants === 1 ? "" : "s"} checked · ` : ""}baseline {ad.baselineLockedBy?.startsWith("keel") ? "locked on first sight" : "approved by a person"} {relTime(ad.baselineLockedAt)}
        </p>
      </div>
    </Card>
  );
}
