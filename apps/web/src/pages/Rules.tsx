import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type KeyboardEvent } from "react";
import { ACTION_LABEL, api, featureLabel, type Brand, type Rulebook } from "../api.ts";
import { IconBook, IconSparkle, IconX } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, Empty, ErrorNote, Field, Input, List, PageHeader, Row, SectionTitle, Segmented, Skeleton, Switch, Textarea, relTime } from "../components/ui.tsx";

type Draft = Omit<Rulebook, "brand" | "version">;
const EMPTY: Draft = { audience: { description: "", casting: [] }, palette: [], tone: "", banned: [], claimLimits: [], productTruths: [], lockedEnhancements: [], severityOverrides: {} };
const COMMON_FEATURES = ["image_touchups", "image_uncrop", "image_background_gen", "text_optimizations", "text_generation", "image_templates", "enhance_cta", "music", "image_animation", "add_text_overlay"];

export function Rules() {
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.brands });
  const [id, setId] = useState<string>();
  const sorted = [...(brands.data ?? [])].sort((a, b) => Number(a.isDemo) - Number(b.isDemo) || Number(b.role === "owner") - Number(a.role === "owner"));
  const brand = sorted.find((b) => b.id === id) ?? sorted[0];
  return (
    <div>
      <PageHeader title="Rules" subtitle="What Keel judges every variant against, and what it may do without asking."
        actions={brands.data && brands.data.length > 1 && (
          <select value={brand?.id} onChange={(e) => setId(e.target.value)} className="h-9 rounded-[10px] bg-fill px-3 text-[14px]">
            {sorted.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isDemo ? " (demo)" : ""}</option>)}
          </select>
        )} />
      {brands.isLoading ? <Skeleton className="h-96" /> : brands.isError ? <ErrorNote error={brands.error} /> : !brand ? (
        <Card><Empty icon={<IconBook size={26} />} title="No brands yet">Connect an ad account first; each account belongs to a brand.</Empty></Card>
      ) : (
        <div key={brand.id} className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
          <RulebookEditor brand={brand} />
          <div className="space-y-8"><PolicyEditor brand={brand} /><DraftPanel brand={brand} /></div>
        </div>
      )}
    </div>
  );
}

function RulebookEditor({ brand }: { brand: Brand }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(brand.rulebook?.rules ?? EMPTY);
  useEffect(() => setD(brand.rulebook?.rules ?? EMPTY), [brand.rulebook?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = brand.role === "owner" && !brand.isDemo;
  const dirty = JSON.stringify(d) !== JSON.stringify(brand.rulebook?.rules ?? EMPTY);
  const save = useMutation({
    mutationFn: () => api.saveRulebook(brand.id, d),
    onSuccess: (r) => { toast(`Saved as version ${r.version}`); void qc.invalidateQueries({ queryKey: ["brands"] }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  return (
    <section>
      <SectionTitle action={<span className="text-[12px] text-ink-3">{brand.rulebook ? `v${brand.rulebook.version} · ${relTime(brand.rulebook.createdAt)}` : "Not set yet"}</span>}>
        {brand.name} rulebook
      </SectionTitle>
      <Card className="space-y-6 p-5 md:p-6">
        <Field label="Audience" hint="Who these ads speak to. Keel flags variants that cast or style for someone else.">
          <Textarea rows={2} disabled={!editable} value={d.audience.description} placeholder="Women 25–40 who run before work; practical, not glossy."
            onChange={(e) => set("audience", { ...d.audience, description: e.target.value })} />
        </Field>
        <Tags label="Who may appear" value={d.audience.casting} disabled={!editable} placeholder="e.g. women 25–40" onChange={(v) => set("audience", { ...d.audience, casting: v })} />
        <Palette value={d.palette} disabled={!editable} onChange={(v) => set("palette", v)} />
        <Field label="Tone"><Input disabled={!editable} value={d.tone} placeholder="Calm, direct, no exclamation marks" onChange={(e) => set("tone", e.target.value)} /></Field>
        <Tags label="Never show" value={d.banned} disabled={!editable} placeholder="e.g. alcohol, competitor logos" onChange={(v) => set("banned", v)} />
        <Tags label="Claim limits" value={d.claimLimits} disabled={!editable} placeholder="e.g. no “waterproof”, no % discounts" onChange={(v) => set("claimLimits", v)} />
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Always keep off</span>
          <p className="mb-3 text-[13px] text-ink-3">Keel flags these as high severity whenever Meta switches them on, on any ad.</p>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...COMMON_FEATURES, ...d.lockedEnhancements])].map((f) => {
              const on = d.lockedEnhancements.includes(f);
              return (
                <button key={f} disabled={!editable} onClick={() => set("lockedEnhancements", on ? d.lockedEnhancements.filter((x) => x !== f) : [...d.lockedEnhancements, f])}
                  className={`press h-8 rounded-full px-3 text-[13px] font-medium disabled:opacity-60 ${on ? "bg-ink text-bg" : "bg-fill text-ink-2 hover:bg-fill-strong"}`}>
                  {featureLabel(f)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t hairline pt-4">
          {!editable && <span className="mr-auto text-[13px] text-ink-2">Only owners can edit the rulebook.</span>}
          {dirty && editable && <Button variant="plain" onClick={() => setD(brand.rulebook?.rules ?? EMPTY)}>Discard</Button>}
          <Button variant="primary" disabled={!dirty || !editable} loading={save.isPending} onClick={() => save.mutate()}>Save rulebook</Button>
        </div>
      </Card>
      {brand.learned > 0 && <p className="mt-3 px-1 text-[13px] text-ink-2">Keel has learned from {brand.learned} finding{brand.learned === 1 ? "" : "s"} you kept running and won't raise them again.</p>}
    </section>
  );
}

function Tags({ label, value, onChange, placeholder, disabled }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder: string; disabled?: boolean }) {
  const [text, setText] = useState("");
  const add = () => { const t = text.trim(); if (t && !value.includes(t)) onChange([...value, t]); setText(""); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border hairline bg-surface px-2 py-1.5 focus-within:border-accent">
        {value.map((t) => (
          <span key={t} className="inline-flex h-7 animate-fade items-center gap-1 rounded-full bg-fill pr-1 pl-2.5 text-[13px]">
            {t}
            {!disabled && <button aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="grid h-5 w-5 place-items-center rounded-full text-ink-2 hover:bg-fill-strong"><IconX size={12} /></button>}
          </span>
        ))}
        {!disabled && <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder={value.length ? "" : placeholder} className="h-7 min-w-32 flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-ink-3" />}
      </div>
    </div>
  );
}

function Palette({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Palette</span>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((c, i) => (
          <span key={i} className="group relative">
            <input type="color" disabled={disabled} value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#000000"} aria-label={`Colour ${c}`}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
              className="h-9 w-9 cursor-pointer appearance-none rounded-full border hairline p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0" />
            {!disabled && <button aria-label="Remove colour" onClick={() => onChange(value.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 hidden h-4 w-4 place-items-center rounded-full bg-ink text-bg group-hover:grid"><IconX size={10} /></button>}
          </span>
        ))}
        {!disabled && <button onClick={() => onChange([...value, "#0071e3"])} className="press grid h-9 w-9 place-items-center rounded-full border border-dashed border-[var(--ink-3)] text-ink-2" aria-label="Add colour">+</button>}
      </div>
    </div>
  );
}

function PolicyEditor({ brand }: { brand: Brand }) {
  const qc = useQueryClient();
  const toast = useToast();
  const editable = brand.role === "owner" && !brand.isDemo;
  const save = useMutation({
    mutationFn: (p: Partial<Brand["policy"]>) => api.savePolicy(brand.id, p),
    onSuccess: () => { toast("Saved"); void qc.invalidateQueries({ queryKey: ["brands"] }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const p = brand.policy;
  const toggle = (a: string, on: boolean) => save.mutate({ autoActions: on ? [...new Set([...p.autoActions, a])] : p.autoActions.filter((x) => x !== a) });
  return (
    <section>
      <SectionTitle>Approvals</SectionTitle>
      <List>
        {["RELOCK_SETTING", "PAUSE_AD", "REVERT_CREATIVE"].map((a) => (
          <Row key={a} title={ACTION_LABEL[a]} detail={p.autoActions.includes(a) ? "Keel does this on its own" : "Asks you first"}>
            <Switch label={`Let Keel ${ACTION_LABEL[a]} without asking`} disabled={!editable || save.isPending} checked={p.autoActions.includes(a)} onChange={(v) => toggle(a, v)} />
          </Row>
        ))}
        <div className="space-y-2.5 px-4 py-3">
          <div><div>Act only when Keel is at least</div><div className="text-[13px] text-ink-2">Less certain findings are logged, never acted on</div></div>
          <div className="grid">
            <Segmented label="Minimum confidence" value={String(p.minConfidence)} onChange={(v) => editable && save.mutate({ minConfidence: Number(v) })}
              options={[0.5, 0.6, 0.75, 0.9].map((n) => ({ value: String(n), label: `${n * 100}%` }))} />
          </div>
        </div>
        <Row title="Requests expire after" detail="Unanswered requests close; the ad is left as it is">
          <select disabled={!editable} value={p.approvalTtlHours} onChange={(e) => save.mutate({ approvalTtlHours: Number(e.target.value) })} className="h-8 rounded-[10px] bg-fill px-2 text-[13px]">
            {[2, 6, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hours</option>)}
          </select>
        </Row>
      </List>
    </section>
  );
}

function DraftPanel({ brand }: { brand: Brand }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [urls, setUrls] = useState("");
  const [guide, setGuide] = useState("");
  const list = urls.split(/\s+/).filter((u) => /^https?:\/\//.test(u));
  const draft = useMutation({
    mutationFn: () => api.draftRulebook({ brandId: brand.id, adImageUrls: list.slice(0, 10), guidelines: guide || undefined }),
    onSuccess: () => { toast("Muse Wonder drafted a new rulebook"); void qc.invalidateQueries({ queryKey: ["brands"] }); setUrls(""); },
  });
  if (brand.role !== "owner" || brand.isDemo) return null;
  return (
    <section>
      <SectionTitle>Draft from your best ads</SectionTitle>
      <Card className="space-y-4 p-5">
        <p className="text-[14px] text-ink-2">Paste up to 10 image links from ads you're proud of. Muse Wonder reads them and drafts the rulebook; you review and save.</p>
        <Textarea rows={3} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://…/hero.jpg" />
        <Textarea rows={3} value={guide} onChange={(e) => setGuide(e.target.value)} placeholder="Brand guidelines (optional)" />
        {draft.isError && <ErrorNote error={draft.error} />}
        <Button className="w-full" icon={<IconSparkle size={16} />} disabled={!list.length} loading={draft.isPending} onClick={() => draft.mutate()}>
          Draft with Muse Wonder{list.length ? ` · ${Math.min(list.length, 10)} ads` : ""}
        </Button>
      </Card>
    </section>
  );
}
