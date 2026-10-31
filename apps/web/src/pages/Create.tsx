import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type DragEvent } from "react";
import { api, mediaUrl, studio } from "../api.ts";
import { IconPlus, IconSparkle, IconX } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Pill, SectionTitle, Skeleton, Spinner, Textarea, cx, relTime } from "../components/ui.tsx";

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "critical" | "medium" }> = {
  drafting: { label: "Creating", tone: "accent" }, ready: { label: "Ready to review", tone: "medium" }, launching: { label: "Launching", tone: "accent" },
  launched: { label: "Launched · paused", tone: "ok" }, failed: { label: "Needs attention", tone: "critical" },
};

/** Studio home: every campaign made here, newest first. */
export function Create() {
  const projects = useQuery({ queryKey: ["studio", "projects"], queryFn: studio.projects, refetchInterval: (q) => (q.state.data?.some((p) => p.status === "drafting" || p.status === "launching") ? 3000 : false) });
  return (
    <div>
      <PageHeader title="Create" subtitle="Turn a product and a brief into on-brand ads in every size, then launch them paused with AI enhancements locked."
        actions={<Link to="/create/new"><Button variant="primary" icon={<IconPlus size={16} />}>New campaign</Button></Link>} />
      {projects.isLoading ? <Skeleton className="h-64" /> : projects.isError ? <ErrorNote error={projects.error} /> : !projects.data?.length ? (
        <Card>
          <Empty icon={<IconSparkle size={26} />} title="Make your first campaign"
            action={<Link to="/create/new"><Button variant="primary" size="lg">Start with a product</Button></Link>}>
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
    </div>
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
    ageMin: 18, ageMax: 65, dailyBudget: 500, startDate: day(1), endDate: day(15), notes: "",
  });
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
      <PageHeader title="New campaign" subtitle="Keel's agent does the rest: three directions, scenes with your real product, every size, checked." />
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
