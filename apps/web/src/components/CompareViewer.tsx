import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { mediaUrl, type Region } from "../api.ts";

interface Props { originalRef: string | null; variantRef: string | null; regions: Region[]; showMasks: boolean }

/**
 * The approved original and what Meta served, stacked. Drag the waterline (or use ← →)
 * to reveal one over the other; region outlines are drawn on the served side.
 */
export function CompareViewer({ originalRef, variantRef, regions, showMasks }: Props) {
  const [split, setSplit] = useState(50);
  const box = useRef<HTMLDivElement>(null);

  const moveTo = useCallback((clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setSplit(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  }, []);
  const onPointer = (e: PointerEvent<HTMLDivElement>) => { if (e.buttons === 1) moveTo(e.clientX); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 5));
    if (e.key === "ArrowRight") setSplit((s) => Math.min(100, s + 5));
  };

  const original = mediaUrl(originalRef);
  const served = mediaUrl(variantRef);

  return (
    <figure className="select-none">
      <div
        ref={box}
        role="slider"
        aria-label="Compare approved original with what Meta served"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split)}
        tabIndex={0}
        onPointerDown={(e) => moveTo(e.clientX)}
        onPointerMove={onPointer}
        onKeyDown={onKey}
        className="relative aspect-square w-full cursor-ew-resize overflow-hidden rounded-sm bg-chart-deep touch-none"
      >
        {served ? <img src={served} alt="What Meta served" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
          : <Missing label="No served variant" />}
        {showMasks && regions.map((r, i) => (
          <div
            key={i}
            className="absolute rounded-[3px] border-2 border-dashed border-port"
            style={{ left: `${r.box[0] * 100}%`, top: `${r.box[1] * 100}%`, width: `${(r.box[2] - r.box[0]) * 100}%`, height: `${(r.box[3] - r.box[1]) * 100}%` }}
          >
            <span className="absolute -top-6 left-0 whitespace-nowrap rounded-sm bg-port px-1.5 py-0.5 text-xs text-white">{r.label}</span>
          </div>
        ))}
        <div className="absolute inset-0 bg-chart-deep" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
          {original ? <img src={original} alt="Approved original" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            : <Missing label="No approved original" />}
        </div>
        {/* The waterline */}
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split}%` }}>
          <div className="h-full w-[2px] -translate-x-1/2 bg-brass" />
          <div className="absolute top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brass bg-chart" />
        </div>
      </div>
      <figcaption className="mt-2 flex justify-between text-sm text-hull-soft">
        <span>Approved original</span>
        <span>What Meta served</span>
      </figcaption>
    </figure>
  );
}

function Missing({ label }: { label: string }) {
  return <div className="absolute inset-0 grid place-items-center text-fog">{label}</div>;
}
