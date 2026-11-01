import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type DragEvent } from "react";
import { api, autopilot, mediaUrl, studio } from "../api.ts";
import { AUTOPILOT_STATUS } from "./Autopilot.tsx";
import { IconArrowRight, IconLink, IconPlus, IconSparkle, IconX } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Pill, SectionTitle, Skeleton, Spinner, Textarea, cx, relTime } from "../components/ui.tsx";

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "critical" | "medium" }> = {
  drafting: { label: "Creating", tone: "accent" }, ready: { label: "Ready to review", tone: "medium" }, launching: { label: "Launching", tone: "accent" },
  launched: { label: "Launched · paused", tone: "ok" }, failed: { label: "Needs attention", tone: "critical" },
};

/** Create: paste a website and let Autopilot run it, or build a campaign from a brief. */
export function Create() {
  const projects = useQuery({ queryKey: ["studio", "projects"], queryFn: studio.projects, refetchInterval: (q) => (q.state.data?.some((p) => p.status === "drafting" || p.status === "launching") ? 3000 : false) });
  const runs = useQuery({ queryKey: ["autopilot", "list"], queryFn: autopilot.list, refetchInterval: (q) => (q.state.data?.some((a) => ["reading", "crafting", "launching"].includes(a.status)) ? 3000 : 30_000) });
  return (
    <div>
      <PageHeader title="Create" subtitle="Paste your website and Keel runs the campaign: research, ads, launch on your go-ahead, then it learns and improves." />
      <AutopilotStart />
      {runs.data && runs.data.length > 0 && (
        <section className="mt-8">
          <SectionTitle>On autopilot</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {runs.data.map((a, i) => {
              const st = AUTOPILOT_STATUS[a.status] ?? { label: a.status, tone: "neutral" as const };
              const busy = ["reading", "crafting", "launching"].includes(a.status);
              return (
                <Link key={a.id} to="/autopilot/$id" params={{ id: a.id }} className="block animate-enter" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                  <Card className="press overflow-hidden transition-shadow duration-200 hover:shadow-[var(--shadow-pop)]">
                    <div className="grid aspect-[3/1] grid-cols-3 gap-px bg-fill">
                      {[0, 1, 2].map((k) => <div key={k} className="bg-fill">{a.covers[k] ? <img src={mediaUrl(a.covers[k]!)} alt="" loading="lazy" className="h-full w-full object-cover" /> : busy ? <Skeleton className="h-full rounded-none" /> : null}</div>)}
                    </div>
                    <div className="flex items-center gap-3 p-4">
                      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border hairline bg-white">
                        {a.logoRef ? <img src={mediaUrl(a.logoRef)} alt="" className="h-full w-full object-contain p-1.5" /> : <IconLink size={16} className="text-ink-3" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{a.brand ?? host(a.url)}</div>
                        <div className="truncate text-[13px] text-ink-2">{host(a.url)} · {relTime(a.createdAt)}</div>
                      </div>
                      {a.pending ? <Pill tone="medium">{a.pending} to approve</Pill> : <Pill tone={st.tone}>{busy && <Spinner className="h-3 w-3" />}{st.label}</Pill>}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}
      <section className="mt-8">
        <SectionTitle action={<Link to="/create/new"><Button size="sm" icon={<IconPlus size={14} />}>From a brief</Button></Link>}>Campaigns</SectionTitle>
        {projects.isLoading ? <Skeleton className="h-64" /> : projects.isError ? <ErrorNote error={projects.error} /> : !projects.data?.length ? (
          <Card>
            <Empty icon={<IconSparkle size={26} />} title="Or start from a product photo"
              action={<Link to="/create/new"><Button size="lg">Start with a brief</Button></Link>}>
              Upload a product photo and say who it's for. Keel plans three directions, puts your real product into new scenes, lays out every ad size and checks each design before you see it.
            </Empty>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.data.map((p, i) => {
              const st = STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
              return (
                <Link key={p.id} to="/create/$id" params={{ id: p.id }} className="block animate-enter" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                  <Card className="press overflow-hidden transition-shadow duration-200 hover:shadow-[var(--shadow-pop)]">
                    <div className="grid aspect-[3/1] grid-cols-3 gap-px bg-fill">
                      {[0, 1, 2].map((k) => (
                        <div key={k} className="bg-fill">
                          {p.covers[k] ? <img src={mediaUrl(p.covers[k]!)} alt="" loading="lazy" className="h-full w-full object-cover" /> : p.status === "drafting" ? <Skeleton className="h-full rounded-none" /> : null}
                        </div>
                      ))}
                    </div>
                    <div className="flex items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{p.name}</div>
                        <div className="truncate text-[13px] text-ink-2">{p.brief.productName} · {relTime(p.createdAt)}</div>
                      </div>
                      <Pill tone={st.tone}>{(p.status === "drafting" || p.status === "launching") && <Spinner className="h-3 w-3" />}{st.label}</Pill>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };

/** The one-field start: a website address and a daily budget. */
function AutopilotStart() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const navigate = useNavigate();
  const accounts = (me.data?.accounts ?? []).filter((a) => !a.isDemo && a.role !== "viewer");
  const [url, setUrl] = useState("");
  const [budget, setBudget] = useState(500);
  const [account, setAccount] = useState("");
  const accountId = account || accounts[0]?.metaAccountId || "";
  const start = useMutation({
    mutationFn: () => autopilot.start({ accountId, url: url.trim(), dailyBudget: budget }),
    onSuccess: ({ id }) => void navigate({ to: "/autopilot/$id", params: { id } }),
  });
  const ok = url.trim().length > 3 && budget > 0 && !!accountId;
  return (
    <Card className="relative overflow-hidden p-6 md:p-8">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2 text-[13px] font-medium text-accent"><IconSparkle size={15} />Autopilot</div>
        <h2 className="mt-1 text-[24px] leading-tight font-semibold md:text-[28px]">Paste your website. Keel runs the campaign.</h2>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-2">It reads your brand and products, studies competitors' ads on Meta, makes art-directed ads and a Reel storyboard, launches when you say so, then reads the results and proposes what to change next.</p>
        <form className="mt-5 flex flex-col gap-3 lg:flex-row" onSubmit={(e) => { e.preventDefault(); if (ok) start.mutate(); }}>
          <div className="relative flex-1">
            <IconLink size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" />
            <Input aria-label="Website" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourshop.com" inputMode="url" autoComplete="url" className="h-12 pl-10 text-[16px]" />
          </div>
          <label className="flex h-12 items-center gap-2 rounded-xl border hairline bg-surface px-3 text-[14px] text-ink-2">
            Daily budget
            <input type="number" min={1} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="w-24 bg-transparent text-[16px] text-ink tabular-nums outline-none" />
          </label>
          {accounts.length > 1 && (
            <select aria-label="Ad account" value={accountId} onChange={(e) => setAccount(e.target.value)} className="h-12 rounded-xl border hairline bg-surface px-3 text-[15px]">
              {accounts.map((a) => <option key={a.metaAccountId} value={a.metaAccountId}>{a.name}</option>)}
            </select>
          )}
          <Button type="submit" variant="primary" size="lg" className="h-12" disabled={!ok} loading={start.isPending} icon={<IconArrowRight size={16} />}>Start</Button>
        </form>
        {me.isSuccess && !accounts.length && <p className="mt-3 text-[13px] text-ink-2">Connect a Meta ad account in <Link to="/settings" className="text-accent">Settings</Link> first.</p>}
        {start.isError && <div className="mt-3"><ErrorNote error={start.error} /></div>}
        <p className="mt-4 text-[13px] text-ink-3">Nothing spends without your approval. Meta's AI enhancements stay locked off, and Keel watches every ad it makes.</p>
      </div>
    </Card>
  );
}

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** The brief: everything the agent needs, nothing it can work out itself. */
export function NewCampaign() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const navigate = useNavigate();
  const toast = useToast();
  const accounts = (me.data?.accounts ?? []).filter((a) => !a.isDemo && a.role !== "viewer");
  const [f, setF] = useState({
    accountId: "", name: "", productName: "", productUrl: "", price: "", offer: "", audience: "", countries: "IN",
    ageMin: 18, ageMax: 65, dailyBudget: 500, startDate: day(1), endDate: day(15), notes: "", competitors: "",
  });
  const [shots, setShots] = useState<{ ref: string; preview: string }[]>([]);
  const shotInput = useRef<HTMLInputElement>(null);
  const addShots = async (files: FileList | null) => {
    for (const file of Array.from(files ?? []).slice(0, 12 - shots.length)) {
      try { const { ref } = await studio.upload(file); setShots((xs) => [...xs, { ref, preview: URL.createObjectURL(file) }]); }
      catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
    }
  };
  const [photos, setPhotos] = useState<{ ref: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const accountId = f.accountId || accounts[0]?.metaAccountId || "";

  const addFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? []).slice(0, 6 - photos.length)) {
      setUploading((n) => n + 1);
      try {
        const { ref } = await studio.upload(file);
        setPhotos((xs) => [...xs, { ref, preview: URL.createObjectURL(file) }]);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files); };

  const create = useMutation({
    mutationFn: () => studio.create({
      accountId, name: f.name || f.productName,
      brief: {
        productName: f.productName, productUrl: f.productUrl, productPhotos: photos.map((p) => p.ref), referenceImages: [], price: f.price, offer: f.offer,
        audience: f.audience, countries: f.countries.split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase()).slice(0, 25), ageMin: f.ageMin, ageMax: f.ageMax,
        dailyBudget: f.dailyBudget, startDate: f.startDate, endDate: f.endDate, notes: f.notes,
        competitors: f.competitors.split(/[,\n]+/).map((c) => c.trim()).filter(Boolean).slice(0, 8), competitorShots: shots.map((s) => s.ref),
      },
    }),
    onSuccess: (r) => void navigate({ to: "/create/$id", params: { id: r.id } }),
  });
  const ready = accountId && f.productName && /^https?:\/\//.test(f.productUrl) && photos.length && !uploading && f.dailyBudget > 0;

  if (me.isSuccess && !accounts.length) {
    return <Card><Empty icon={<IconSparkle size={26} />} title="Connect an ad account first" action={<Link to="/settings"><Button variant="primary">Go to Settings</Button></Link>}>Studio launches campaigns into one of your Meta ad accounts.</Empty></Card>;
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="New campaign" subtitle="Keel's agent does the rest: studies competitors, plans three directions and a storyboard, shoots and art-directs, lays out every size, checks it." />
      <div className="space-y-8">
        <section>
          <SectionTitle>Product</SectionTitle>
          <Card className="space-y-5 p-5">
            <div
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
              className={cx("rounded-2xl border-[1.5px] border-dashed p-4 transition-colors duration-150", over ? "border-accent bg-accent/6" : "border-[var(--line)]")}
            >
              <div className="flex flex-wrap gap-3">
                {photos.map((p, i) => (
                  <div key={p.ref} className="group relative h-24 w-24 animate-fade overflow-hidden rounded-xl bg-fill">
                    <img src={p.preview} alt="" className="h-full w-full object-cover" />
                    {i === 0 && <span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 text-[10px] font-medium text-white">Main</span>}
                    <button aria-label="Remove" onClick={() => setPhotos((xs) => xs.filter((x) => x.ref !== p.ref))} className="absolute top-1 right-1 hidden h-6 w-6 place-items-center rounded-full bg-black/60 text-white group-hover:grid"><IconX size={12} /></button>
                  </div>
                ))}
                {photos.length < 6 && (
                  <button onClick={() => input.current?.click()} className="press grid h-24 w-24 place-items-center rounded-xl bg-fill text-ink-2 hover:bg-fill-strong">
                    {uploading ? <Spinner /> : <IconPlus size={22} />}
                  </button>
                )}
                <div className="min-w-48 flex-1 self-center text-[13px] text-ink-2">
                  <p className="font-medium text-ink">Product photos</p>
                  <p>Drop them here. The first is the main one; a clean shot on a plain background works best. Keel never redraws your product.</p>
                </div>
              </div>
              <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product name"><Input value={f.productName} onChange={(e) => set("productName", e.target.value)} placeholder="Monsoon Jacket" /></Field>
              <Field label="Product page"><Input value={f.productUrl} onChange={(e) => set("productUrl", e.target.value)} placeholder="https://…" inputMode="url" /></Field>
              <Field label="Price" hint="Shown exactly as typed"><Input value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="₹3,499" /></Field>
              <Field label="Offer" hint="Optional. Only offers you really run"><Input value={f.offer} onChange={(e) => set("offer", e.target.value)} placeholder="Free shipping" /></Field>
            </div>
          </Card>
        </section>

        <section>
          <SectionTitle>Audience and budget</SectionTitle>
          <Card className="space-y-5 p-5">
            <Field label="Who it's for" hint="In your own words. The agent writes for this person.">
              <Textarea rows={2} value={f.audience} onChange={(e) => set("audience", e.target.value)} placeholder="Office commuters in Mumbai and Pune who walk or take trains in the monsoon" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Countries" hint="Two-letter codes"><Input value={f.countries} onChange={(e) => set("countries", e.target.value)} placeholder="IN" /></Field>
              <Field label="Age from"><Input type="number" min={18} max={65} value={f.ageMin} onChange={(e) => set("ageMin", Number(e.target.value))} /></Field>
              <Field label="Age to"><Input type="number" min={18} max={65} value={f.ageMax} onChange={(e) => set("ageMax", Number(e.target.value))} /></Field>
              <Field label="Daily budget" hint="In the ad account's currency"><Input type="number" min={1} value={f.dailyBudget} onChange={(e) => set("dailyBudget", Number(e.target.value))} /></Field>
              <Field label="Start"><Input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
              <Field label="End"><Input type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
            </div>
          </Card>
        </section>

        <section>
          <SectionTitle>Competitors</SectionTitle>
          <Card className="space-y-5 p-5">
            <Field label="Who you compete with" hint="Brands or Facebook Page names, comma-separated. Optional: the agent finds more on its own.">
              <Input value={f.competitors} onChange={(e) => set("competitors", e.target.value)} placeholder="Decathlon, Wildcraft, The North Face" />
            </Field>
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Competitor ads you've seen</span>
              <div className="flex flex-wrap gap-2">
                {shots.map((x) => (
                  <div key={x.ref} className="group relative h-20 w-16 animate-fade overflow-hidden rounded-lg bg-fill">
                    <img src={x.preview} alt="" className="h-full w-full object-cover" />
                    <button aria-label="Remove" onClick={() => setShots((xs) => xs.filter((y) => y.ref !== x.ref))} className="absolute top-1 right-1 hidden h-5 w-5 place-items-center rounded-full bg-black/60 text-white group-hover:grid"><IconX size={10} /></button>
                  </div>
                ))}
                {shots.length < 12 && <button onClick={() => shotInput.current?.click()} className="press grid h-20 w-16 place-items-center rounded-lg bg-fill text-ink-2 hover:bg-fill-strong"><IconPlus size={18} /></button>}
              </div>
              <p className="mt-1.5 text-[13px] text-ink-3">Screenshots help most outside the EU, where Meta's Ad Library doesn't list ordinary ads.</p>
              <input ref={shotInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => void addShots(e.target.files)} />
            </div>
          </Card>
        </section>

        <section>
          <SectionTitle>Where it launches</SectionTitle>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Ad account">
              <select value={accountId} onChange={(e) => set("accountId", e.target.value)} className="h-10 w-full rounded-xl border hairline bg-surface px-3 text-[15px]">
                {accounts.map((a) => <option key={a.metaAccountId} value={a.metaAccountId}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Campaign name" hint="Optional"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={f.productName || "Monsoon launch"} /></Field>
            <div className="sm:col-span-2"><Field label="Anything else the agent should know" hint="Optional"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Lean into the rain; avoid beach imagery." /></Field></div>
          </Card>
        </section>

        {create.isError && <ErrorNote error={create.error} />}
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-ink-2">Nothing goes live: Keel shows you every design first, and launches paused.</p>
          <Button variant="primary" size="lg" icon={<IconSparkle size={16} />} disabled={!ready} loading={create.isPending} onClick={() => create.mutate()}>Create the ads</Button>
        </div>
      </div>
    </div>
  );
}
