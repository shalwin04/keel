import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { api } from "../api.ts";
import { useLiveEvents } from "../events.ts";
import { IconBook, IconGear, IconGrid, IconInbox, IconPulse, IconShield, IconSparkle, Logo } from "./Icons.tsx";
import { cx } from "./ui.tsx";

const NAV: { to: string; label: string; icon: (p: { size?: number }) => ReactNode; mobile?: boolean }[] = [
  { to: "/create", label: "Create", icon: IconSparkle, mobile: true },
  { to: "/", label: "Review", icon: IconInbox, mobile: true },
  { to: "/activity", label: "Activity", icon: IconPulse, mobile: true },
  { to: "/ads", label: "Ads", icon: IconGrid, mobile: true },
  { to: "/rules", label: "Rules", icon: IconBook },
  { to: "/audit", label: "Audit log", icon: IconShield },
  { to: "/settings", label: "Settings", icon: IconGear, mobile: true },
];

export function Shell() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const live = useLiveEvents(me.isSuccess);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const queue = useQuery({ queryKey: ["queue", "pending"], queryFn: () => api.queue("pending"), enabled: me.isSuccess });
  useEffect(() => { if (me.isError) void navigate({ to: "/login" }); }, [me.isError, navigate]);
  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  if (me.isError) return null;
  const pending = queue.data?.length ?? 0;
  const isActive = (to: string) => (to === "/" ? path === "/" || path.startsWith("/review") : path.startsWith(to));
  const demo = me.data?.accounts.length ? me.data.accounts.every((a) => a.isDemo) : false;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      {/* Sidebar (tablet and up) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r hairline bg-surface/60 px-3 pt-5 pb-4 md:flex">
        <Link to="/" className="mb-6 flex items-center gap-2.5 px-2.5 text-ink">
          <Logo size={26} />
          <span className="text-[17px] font-semibold tracking-tight">Keel</span>
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={isActive(n.to) ? "page" : undefined}
              className={cx("flex h-9 items-center gap-3 rounded-[10px] px-2.5 text-[14px] transition-colors duration-150",
                isActive(n.to) ? "bg-fill-strong font-medium text-ink" : "text-ink-2 hover:bg-fill hover:text-ink")}>
              <n.icon size={18} />
              <span className="flex-1">{n.label}</span>
              {n.to === "/" && pending > 0 && <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-[12px] font-semibold leading-5 text-accent-ink">{pending}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-2.5">
          {demo && <p className="rounded-xl bg-fill px-3 py-2 text-[12px] text-ink-2">Demo workspace. Decisions are simulated.</p>}
          <LiveDot live={live} />
          {me.data && (
            <div className="flex items-center gap-2.5">
              <Avatar name={me.data.user.name} />
              <div className="min-w-0 flex-1 text-[13px]">
                <div className="truncate font-medium">{me.data.user.name}</div>
                <button className="text-ink-2 hover:text-ink" onClick={async () => { await api.logout(); qc.clear(); void navigate({ to: "/login" }); }}>Sign out</button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="material sticky top-0 z-30 flex h-12 items-center justify-between border-b hairline px-4 pt-[env(safe-area-inset-top)] md:hidden">
        <Link to="/" className="flex items-center gap-2 text-ink"><Logo size={22} /><span className="font-semibold">Keel</span></Link>
        <LiveDot live={live} compact />
      </header>

      <main className="mx-auto w-full max-w-[1240px] px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+96px)] md:px-8 md:pt-8 md:pb-12">
        <div key={path.split("/")[1]} className="animate-fade">
          <Outlet />
        </div>
      </main>

      {/* Mobile tab bar */}
      <nav aria-label="Main" className="material fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t hairline pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.filter((n) => n.mobile).map((n) => (
          <Link key={n.to} to={n.to} aria-current={isActive(n.to) ? "page" : undefined}
            className={cx("press relative flex h-[56px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium", isActive(n.to) ? "text-accent" : "text-ink-2")}>
            <n.icon size={22} />
            {n.label}
            {n.to === "/" && pending > 0 && <span className="absolute top-1.5 left-[calc(50%+6px)] min-w-4 rounded-full bg-critical px-1 text-center text-[10px] leading-4 text-white">{pending}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function LiveDot({ live, compact }: { live: string; compact?: boolean }) {
  const label = live === "live" ? "Watching live" : live === "offline" ? "Reconnecting" : "Connecting";
  return (
    <p className="flex items-center gap-2 text-[12px] text-ink-2" title={label}>
      <span className="relative flex h-2 w-2">
        {live === "live" && <span className="absolute inset-0 animate-ping rounded-full bg-ok opacity-40 [animation-duration:2.4s]" />}
        <span className={cx("relative h-2 w-2 rounded-full", live === "live" ? "bg-ok" : live === "offline" ? "bg-critical" : "bg-ink-3")} />
      </span>
      {!compact && label}
    </p>
  );
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-fill-strong text-[11px] font-semibold text-ink-2">{initials}</span>;
}
