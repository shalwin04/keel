import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconX } from "./Icons.tsx";

type Tone = "ok" | "error" | "info";
interface T { id: number; text: string; tone: Tone }
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(Ctx);

/** Bottom-centred toasts; newest on top, each lives 3.6 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const id = useRef(0);
  const push = useCallback((text: string, tone: Tone = "ok") => {
    const t = { id: ++id.current, text, tone };
    setItems((xs) => [...xs.slice(-2), t]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 3600);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div key={t.id} role="status" className="pointer-events-auto flex max-w-md animate-toast items-center gap-2.5 rounded-full bg-raised px-4 py-2.5 text-[14px] font-medium shadow-[var(--shadow-pop)]">
            <span className={t.tone === "error" ? "text-critical" : t.tone === "ok" ? "text-ok" : "text-accent"}>
              {t.tone === "error" ? <IconX size={16} /> : <IconCheck size={16} />}
            </span>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
