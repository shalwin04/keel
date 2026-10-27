import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useLiveEvents } from "../events.ts";
import { enablePush, pushSupported } from "../push.ts";

const NAV = [
  { to: "/", label: "Review" },
  { to: "/trace", label: "Live trace" },
  { to: "/accounts", label: "Accounts" },
  { to: "/audit", label: "Audit log" },
  { to: "/onboarding", label: "Connect an account" },
] as const;

export function Shell() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const live = useLiveEvents(me.isSuccess);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [push, setPush] = useState<string | null>(null);

  const queue = useQuery({ queryKey: ["queue", "pending"], queryFn: () => api.queue("pending"), enabled: me.isSuccess });
  useEffect(() => { if (me.isError) void navigate({ to: "/login" }); }, [me.isError, navigate]);
  if (me.isError) return null;
  const pending = queue.data?.length;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 bg-hull px-5 py-6 text-chart md:sticky md:top-0 md:h-screen md:w-60">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <span className="display text-xl font-semibold">Keel Bridge</span>
        </Link>
        <nav className="flex flex-row flex-wrap gap-1 md:flex-col" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="rounded-sm px-3 py-2 text-chart/75 hover:bg-white/5 hover:text-chart [&.active]:bg-brass/15 [&.active]:text-chart [&.active]:shadow-[inset_3px_0_0_var(--color-brass)]"
            >
              {n.label}
              {n.to === "/" && pending ? <span className="ml-2 rounded-full bg-brass px-1.5 text-xs text-hull">{pending}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3 text-sm text-chart/70">
          <p className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${live === "live" ? "bg-starboard" : live === "offline" ? "bg-port" : "bg-fog"}`} />
            {live === "live" ? "Watching live" : live === "offline" ? "Reconnecting…" : "Connecting…"}
          </p>
          {pushSupported() && (
            <button className="text-left underline-offset-4 hover:underline" onClick={async () => setPush(await enablePush())}>
              {push === "enabled" ? "Alerts on for this device" : push === "denied" ? "Alerts blocked in browser settings" : "Get alerts on this device"}
            </button>
          )}
          {me.data && (
            <p>
              {me.data.user.name}{" "}
              <button className="underline-offset-4 hover:underline" onClick={async () => { await api.logout(); qc.clear(); void navigate({ to: "/login" }); }}>
                Sign out
              </button>
            </p>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
