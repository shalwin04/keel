import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { mediaUrl, type Region } from "../api.ts";

interface Props { originalRef: string | null; variantRef: string | null; regions: Region[]; showMasks: boolean }

/**
 * The approved original and what Meta served, stacked. Drag the divider (or use ← →) to reveal one
 * over the other. Dragging follows the pointer 1:1 with no easing; only keyboard steps animate.
 */
export function CompareViewer({ originalRef, variantRef, regions, showMasks }: Props) {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const moveTo = useCallback((clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setSplit(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  }, []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); setSplit((s) => Math.max(0, s - 10)); }
    if (e.key === "ArrowRight") { e.preventDefault(); setSplit((s) => Math.min(100, s + 10)); }
  };

  const original = mediaUrl(originalRef);
  const served = mediaUrl(variantRef);
  const ease = dragging ? "none" : "clip-path 200ms var(--ease-out), left 200ms var(--ease-out)";

  if (!served) {
    return (
      <figure className="overflow-hidden rounded-2xl bg-fill">
        <div className="relative aspect-[4/3] w-full">
          {original ? <img src={original} alt="Approved original" className="absolute inset-0 h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-ink-3">No image</div>}
        </div>
        <figcaption className="px-4 py-2.5 text-[13px] text-ink-2">Approved creative</figcaption>
      </figure>
    );
  }

  return (
    <figure className="select-none">
      <div
        ref={box}
        role="slider"
        aria-label="Compare the approved original with what Meta served"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split)}
        tabIndex={0}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); moveTo(e.clientX); }}
        onPointerMove={(e) => { if (dragging) moveTo(e.clientX); }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={onKey}
        className="relative aspect-[4/3] w-full cursor-ew-resize touch-none overflow-hidden rounded-2xl bg-fill"
      >
        <img src={served} alt="What Meta served" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
        {showMasks && regions.filter((r) => !(r.box[0] === 0 && r.box[1] === 0 && r.box[2] === 1 && r.box[3] === 1)).map((r, i) => (
          <div key={i} className="absolute animate-fade rounded-md ring-2 ring-critical ring-offset-0"
            style={{ left: `${r.box[0] * 100}%`, top: `${r.box[1] * 100}%`, width: `${(r.box[2] - r.box[0]) * 100}%`, height: `${(r.box[3] - r.box[1]) * 100}%` }}>
            <span className="absolute -top-6 left-0 rounded-md bg-critical px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white">{r.label}</span>
          </div>
        ))}
        <div className="absolute inset-0 bg-fill" style={{ clipPath: `inset(0 ${100 - split}% 0 0)`, transition: ease }}>
          {original ? <img src={original} alt="Approved original" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            : <div className="grid h-full place-items-center text-ink-3">No approved original</div>}
        </div>
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split}%`, transition: ease }}>
          <div className="h-full w-[2px] -translate-x-1/2 bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.2)]" />
          <div className={`absolute top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[#1d1d1f] shadow-[0_2px_10px_rgb(0_0_0/0.25)] transition-transform duration-150 ${dragging ? "scale-110" : ""}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 7-5 5 5 5M15 7l5 5-5 5" /></svg>
          </div>
        </div>
        <span className="absolute top-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur">Approved</span>
        <span className="absolute top-3 right-3 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur">Served by Meta</span>
      </div>
    </figure>
  );
}
