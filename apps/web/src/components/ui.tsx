import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "plain" | "danger";
type Size = "sm" | "md" | "lg";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 shadow-[0_1px_2px_rgb(0_0_0/0.12)]",
  secondary: "bg-fill text-ink hover:bg-fill-strong",
  plain: "text-accent hover:bg-fill",
  danger: "bg-fill text-critical hover:bg-fill-strong",
};
const SIZE: Record<Size, string> = { sm: "h-8 px-3 text-[13px] rounded-[10px] gap-1.5", md: "h-10 px-4 text-[15px] rounded-xl gap-2", lg: "h-12 px-5 text-[16px] rounded-[14px] gap-2" };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...p }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx("press inline-flex select-none items-center justify-center font-medium whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed", VARIANT[variant], SIZE[size], className)}
        {...p}
      >
        {loading ? <Spinner /> : icon}
        {children}
      </button>
    );
  },
);

export const Spinner = ({ className }: { className?: string }) => (
  <svg className={cx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("card", className)} {...p}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3 px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-2">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight md:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="tablist" aria-label={label} className="relative inline-grid rounded-[10px] bg-fill p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 rounded-[8px] bg-raised shadow-[0_1px_3px_rgb(0_0_0/0.12)] transition-transform duration-200 ease-[var(--ease-out)]"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${i * 100}%)` }}
      />
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={cx("relative z-10 h-7 px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150", o.value === value ? "text-ink" : "text-ink-2 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 ease-[var(--ease-out)] disabled:opacity-40", checked ? "bg-ok" : "bg-fill-strong")}>
      <span className={cx("absolute top-[2px] left-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-[var(--ease-out)]", checked && "translate-x-[18px]")} />
    </button>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border hairline bg-surface px-1 font-sans text-[11px] font-medium text-ink-2 shadow-[0_1px_0_var(--line)]">{children}</kbd>
);

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "critical" | "high" | "medium" | "low"; className?: string }) {
  const tones = {
    neutral: "bg-fill text-ink-2",
    accent: "bg-accent/12 text-accent",
    ok: "bg-ok/12 text-ok",
    critical: "bg-critical/12 text-critical",
    high: "bg-high/14 text-high",
    medium: "bg-medium/16 text-medium",
    low: "bg-fill text-ink-2",
  };
  return <span className={cx("inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[12px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md animate-enter flex-col items-center px-6 py-16 text-center">
      {icon && <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-fill text-ink-2">{icon}</div>}
      <h2 className="text-[20px] font-semibold">{title}</h2>
      {children && <div className="mt-2 text-ink-2">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) => <div className={cx("animate-pulse-soft rounded-lg bg-fill", className)} />;

export function ErrorNote({ error }: { error: unknown }) {
  return <p role="alert" className="rounded-xl bg-critical/10 px-4 py-3 text-[14px] text-critical">{error instanceof Error ? error.message : String(error)}</p>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx("h-10 w-full rounded-xl border hairline bg-surface px-3 text-[15px] text-ink placeholder:text-ink-3 transition-shadow duration-150 focus:border-accent focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_18%,transparent)] focus:outline-none", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx("w-full rounded-xl border hairline bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-3 transition-shadow duration-150 focus:border-accent focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_18%,transparent)] focus:outline-none", className)} {...p} />;
});

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[13px] text-ink-3">{hint}</span>}
    </label>
  );
}

/** Grouped list rows, iOS Settings style. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("card divide-y divide-[var(--line)] overflow-hidden", className)}>{children}</div>;
}
export function Row({ title, detail, children, onClick }: { title: ReactNode; detail?: ReactNode; children?: ReactNode; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cx("flex min-h-[52px] w-full items-center gap-4 px-4 py-2.5 text-left", onClick && "transition-colors duration-150 hover:bg-fill")}>
      <div className="min-w-0 flex-1">
        <div className="truncate">{title}</div>
        {detail && <div className="truncate text-[13px] text-ink-2">{detail}</div>}
      </div>
      {children}
    </Comp>
  );
}

export function relTime(iso: string | Date | null | undefined) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const f = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(s) < 45) return "just now";
  if (Math.abs(s) < 3600) return f.format(-Math.round(s / 60), "minute");
  if (Math.abs(s) < 86400) return f.format(-Math.round(s / 3600), "hour");
  return f.format(-Math.round(s / 86400), "day");
}
