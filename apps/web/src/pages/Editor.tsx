import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { designToSvg, type DesignDoc, type Layer } from "@keel/core/studio";
import { mediaUrl, studio } from "../api.ts";
import { IconChevron, IconLock, IconUnlock } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, ErrorNote, Field, Kbd, Segmented, Skeleton, Textarea, cx } from "../components/ui.tsx";

const ROLE_LABEL: Record<string, string> = {
  scene: "Scene", product: "Product photo", logo: "Logo", person: "Person", panel: "Panel", scrim: "Shade", card: "Card", chip: "Chip",
  headline: "Headline", subline: "Subline", price: "Price", cta: "Button", brand: "Brand name", offer: "Offer",
};

/**
 * A small layered editor. The canvas is the same SVG the server renders for launch, so what you see is
 * exactly what ships. Drag to move, arrows to nudge (Shift = 10), edit text and colours on the right.
 */
export function Editor({ id, designId }: { id: string; designId: string }) {
  const q = useQuery({ queryKey: ["studio", "project", id], queryFn: () => studio.project(id) });
  const design = q.data?.designs.find((d) => d.id === designId);
  if (q.isLoading) return <Skeleton className="h-[600px]" />;
  if (q.isError || !design) return <ErrorNote error={q.error ?? "design not found"} />;
  const dir = q.data!.directions?.[design.direction];
  return <EditorInner key={`${design.id}:${design.updatedAt}`} projectId={id} designId={designId} initial={design.doc} palette={dir ? [dir.palette.base, dir.palette.accent, dir.palette.ink, "#ffffff", "#111111"] : ["#ffffff", "#111111"]} siblings={q.data!.designs.filter((d) => d.direction === design.direction)} />;
}

function EditorInner({ projectId, designId, initial, palette, siblings }: { projectId: string; designId: string; initial: DesignDoc; palette: string[]; siblings: { id: string; size: string }[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DesignDoc>(initial);
  const [history, setHistory] = useState<DesignDoc[]>([]);
  const [sel, setSel] = useState<string | null>("headline");
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; scale: number } | null>(null);
  const dirty = JSON.stringify(doc) !== JSON.stringify(initial);
  const layer = doc.layers.find((l) => l.id === sel);

  const svg = useMemo(() => designToSvg(doc, (ref) => mediaUrl(ref) ?? ref), [doc]);
  const commit = (next: DesignDoc) => { setHistory((h) => [...h.slice(-40), doc]); setDoc(next); };
  const patch = (id: string, p: Partial<Layer>) => commit({ ...doc, layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...p } as Layer) : l)) });
  const undo = () => setHistory((h) => { const prev = h.at(-1); if (prev) setDoc(prev); return h.slice(0, -1); });

  const save = useMutation({
    mutationFn: () => studio.saveDesign(designId, { doc }),
    onSuccess: () => { toast("Saved"); void qc.invalidateQueries({ queryKey: ["studio", "project", projectId] }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (dirty) save.mutate(); return; }
      if (!layer || layer.locked) return;
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) { e.preventDefault(); patch(layer.id, { x: layer.x + d[0]!, y: layer.y + d[1]! }); }
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scaleOf = () => (stage.current ? stage.current.getBoundingClientRect().width / doc.w : 1);
  const onDown = (l: Layer) => (e: RPointerEvent) => {
    setSel(l.id);
    if (l.locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: l.id, sx: e.clientX, sy: e.clientY, ox: l.x, oy: l.y, scale: scaleOf() };
    setHistory((h) => [...h.slice(-40), doc]);
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const x = Math.round(d.ox + (e.clientX - d.sx) / d.scale), y = Math.round(d.oy + (e.clientY - d.sy) / d.scale);
    setDoc((cur) => ({ ...cur, layers: cur.layers.map((l) => (l.id === d.id ? { ...l, x, y } : l)) }));
  };
  const onUp = () => { drag.current = null; };

  // Topmost first in the panel, like every design tool.
  const ordered = [...doc.layers].reverse();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to="/create/$id" params={{ id: projectId }} className="inline-flex items-center gap-1 text-[14px] text-accent"><IconChevron size={14} className="rotate-180" /> Back to the campaign</Link>
        <div className="flex items-center gap-2">
          {siblings.length > 1 && (
            <Segmented label="Size" value={designId} onChange={(v) => { if (!dirty || confirm("Leave without saving?")) void navigate({ to: "/create/$id/edit/$designId", params: { id: projectId, designId: v } }); }}
              options={siblings.map((s) => ({ value: s.id, label: s.size === "square" ? "1:1" : s.size === "portrait" ? "4:5" : "9:16" }))} />
          )}
          <Button size="sm" variant="plain" disabled={!history.length} onClick={undo}>Undo</Button>
          <a href={studio.downloadUrl(designId)}><Button size="sm">Download</Button></a>
          <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
        {/* Layers */}
        <Card className="order-2 h-fit overflow-hidden lg:order-1">
          <p className="border-b hairline px-4 py-2.5 text-[12px] font-semibold text-ink-2">Layers</p>
          <ul className="max-h-[60vh] overflow-auto scroll-thin py-1">
            {ordered.map((l) => (
              <li key={l.id}>
                <div className={cx("flex items-center gap-2 px-3 py-1.5 text-[13px]", sel === l.id ? "bg-accent/10 text-ink" : "text-ink-2 hover:bg-fill")}>
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => setSel(l.id)}>
                    {l.id === "design" ? "Muse Image design" : ROLE_LABEL[l.role] ?? l.role}{l.kind === "text" && <span className="text-ink-3"> · {l.text}</span>}
                  </button>
                  <button aria-label={l.locked ? "Unlock" : "Lock"} onClick={() => patch(l.id, { locked: !l.locked })} className="text-ink-3 hover:text-ink">
                    {l.locked ? <IconLock size={13} /> : <IconUnlock size={13} />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* Canvas */}
        <div className="order-1 lg:order-2">
          <div className="mx-auto" style={{ maxWidth: doc.h > doc.w * 1.5 ? 400 : doc.h > doc.w ? 520 : 600 }}>
            <div ref={stage} className="relative w-full overflow-hidden rounded-xl shadow-[var(--shadow-pop)] select-none" style={{ aspectRatio: `${doc.w}/${doc.h}` }}
              onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerDown={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
              <div className="pointer-events-none absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
              {/* Hit areas: only what you'd grab. The scene and shades stay put unless chosen in Layers. */}
              {doc.layers.filter((l) => !["scene", "scrim"].includes(l.role) || l.id === sel).map((l) => (
                <div key={l.id} onPointerDown={onDown(l)}
                  className={cx("absolute", l.locked ? "cursor-default" : "cursor-move", sel === l.id ? "outline-2 outline-accent outline-offset-0" : "hover:outline-1 hover:outline-accent/60")}
                  style={{ left: `${(l.x / doc.w) * 100}%`, top: `${(l.y / doc.h) * 100}%`, width: `${(l.w / doc.w) * 100}%`, height: `${(l.h / doc.h) * 100}%`, outlineStyle: sel === l.id ? "solid" : undefined }} />
              ))}
            </div>
            <RefineBox designId={designId} projectId={projectId} whole={doc.layers.some((l) => l.id === "design")} dirty={dirty} />
            <p className="hover-only mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
              <span className="flex items-center gap-1">Drag to move</span>
              <span className="flex items-center gap-1"><Kbd>←</Kbd><Kbd>→</Kbd> nudge (Shift ×10)</span>
              <span className="flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>Z</Kbd> undo</span>
              <span className="flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>S</Kbd> save</span>
            </p>
          </div>
        </div>

        {/* Properties */}
        <Card className="order-3 h-fit space-y-4 p-4">
          {!layer ? <p className="text-[13px] text-ink-2">Select a layer to edit it.</p> : (
            <>
              <p className="text-[12px] font-semibold text-ink-2">{ROLE_LABEL[layer.role] ?? layer.role}</p>
              {layer.kind === "text" && (
                <>
                  <Field label="Text"><Textarea rows={layer.role === "headline" ? 3 : 2} value={layer.text} onChange={(e) => patch(layer.id, { text: e.target.value })} /></Field>
                  <Field label={`Size · ${Math.round(layer.size)} px`}>
                    <input type="range" min={12} max={160} value={layer.size} onChange={(e) => patch(layer.id, { size: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Weight">
                      <select value={layer.weight} onChange={(e) => patch(layer.id, { weight: Number(e.target.value) })} className="h-9 w-full rounded-[10px] bg-fill px-2 text-[13px]">
                        {[400, 450, 500, 600, 700, 750, 800].map((w) => <option key={w} value={w}>{w}</option>)}
                      </select>
                    </Field>
                    <Field label="Font">
                      <select value={layer.font} onChange={(e) => patch(layer.id, { font: e.target.value as "sans" | "serif" })} className="h-9 w-full rounded-[10px] bg-fill px-2 text-[13px]">
                        <option value="sans">Sans</option><option value="serif">Serif</option>
                      </select>
                    </Field>
                  </div>
                  <Segmented label="Align" value={layer.align} onChange={(v) => patch(layer.id, { align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} />
                  <Swatches label="Colour" value={layer.color} palette={palette} onChange={(c) => patch(layer.id, { color: c })} />
                  {layer.bg !== undefined && <Swatches label="Background" value={layer.bg} palette={palette} onChange={(c) => patch(layer.id, { bg: c })} />}
                </>
              )}
              {layer.kind === "rect" && (
                <>
                  <Swatches label="Fill" value={layer.fill} palette={palette} onChange={(c) => patch(layer.id, { fill: c, fill2: layer.fill2 ? `${c}00` : undefined })} />
                  <Field label={`Opacity · ${Math.round(layer.opacity * 100)}%`}><input type="range" min={0} max={100} value={layer.opacity * 100} onChange={(e) => patch(layer.id, { opacity: Number(e.target.value) / 100 })} className="w-full accent-[var(--accent)]" /></Field>
                </>
              )}
              {layer.kind === "image" && (
                <>
                  <div className="overflow-hidden rounded-lg bg-fill"><img src={mediaUrl(layer.ref)} alt="" className="max-h-32 w-full object-contain" /></div>
                  {layer.role === "product" && <p className="text-[12px] text-ink-2">Your original photo, untouched.</p>}
                  <Segmented label="Fit" value={layer.fit} onChange={(v) => patch(layer.id, { fit: v })} options={[{ value: "cover", label: "Fill" }, { value: "contain", label: "Fit" }]} />
                </>
              )}
              <div className="grid grid-cols-4 gap-2 border-t hairline pt-3">
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <label key={k} className="text-[11px] text-ink-3">{k.toUpperCase()}
                    <input type="number" value={Math.round(layer[k])} onChange={(e) => patch(layer.id, { [k]: Number(e.target.value) })} className="mt-0.5 h-8 w-full rounded-md bg-fill px-1.5 text-[12px] text-ink" />
                  </label>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Swatches({ label, value, palette, onChange }: { label: string; value: string; palette: string[]; onChange: (c: string) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {[...new Set(palette)].map((c) => (
          <button key={c} aria-label={c} onClick={() => onChange(c)} className={cx("press h-7 w-7 rounded-full border hairline", value.toLowerCase().startsWith(c.toLowerCase()) && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]")} style={{ background: c }} />
        ))}
        <input type="color" aria-label="Custom colour" value={/^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : "#000000"} onChange={(e) => onChange(e.target.value)}
          className="h-7 w-7 cursor-pointer appearance-none rounded-full border hairline p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0" />
      </div>
    </div>
  );
}

/** Describe a change in words; Muse Image makes exactly that edit and Muse Spark re-checks the text. */
function RefineBox({ designId, projectId, whole, dirty }: { designId: string; projectId: string; whole: boolean; dirty: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const go = useMutation({
    mutationFn: () => studio.refine(designId, text),
    onSuccess: () => { setText(""); toast("Refined"); void qc.invalidateQueries({ queryKey: ["studio", "project", projectId] }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  return (
    <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim().length > 2 && !dirty) go.mutate(); }}>
      <input value={text} onChange={(e) => setText(e.target.value)} disabled={go.isPending}
        placeholder={whole ? "Refine with Muse Image: warmer light, bigger product, add rain on the window…" : "Refine the artwork: warmer light, add rain, more depth…"}
        className="h-10 min-w-0 flex-1 rounded-xl border hairline bg-surface px-3 text-[14px]" />
      <Button type="submit" variant="primary" loading={go.isPending} disabled={text.trim().length < 3 || dirty} title={dirty ? "Save your layer edits first" : undefined}>Refine</Button>
    </form>
  );
}
