import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { SEVERITY_ORDER, api, type AdRow, type Severity } from "../api.ts";
import { SeverityMark } from "../components/Severity.tsx";

const isOn = (v?: string) => v === "OPT_IN" || v === "DEFAULT_OPT_IN";
const pretty = (k: string) => k.replaceAll("_", " ");

export function Accounts() {
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const [selected, setSelected] = useState<string>();
  const navigate = useNavigate();
  const run = useMutation({
    mutationFn: api.runCycle,
    onSuccess: ({ cycleId }) => void navigate({ to: "/trace", search: { cycle: cycleId } }),
  });
  const active = selected ?? accounts.data?.[0]?.metaAccountId;

  if (accounts.isLoading) return <p className="text-hull-soft">Loading accounts…</p>;
  if (!accounts.data?.length) {
    return (
      <div className="max-w-xl">
        <h1 className="display text-4xl font-semibold">No ad accounts yet</h1>
        <p className="mt-3 text-hull-soft">Connect a Meta ad account and Keel starts watching it.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <h1 className="display mb-6 text-3xl font-semibold">Accounts</h1>
      <ul className="mb-10 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.data.map((a) => {
          const worst = SEVERITY_ORDER.find((s) => (a.openBySeverity[s] ?? 0) > 0);
          const open = Object.values(a.openBySeverity).reduce((n, x) => n + (x ?? 0), 0);
          return (
            <li key={a.metaAccountId} className={`border-l-[3px] pl-4 ${a.metaAccountId === active ? "border-brass" : "border-fog/40"}`}>
              <button onClick={() => setSelected(a.metaAccountId)} className="text-left">
                <p className="font-semibold">{a.name}</p>
                <p className="flex items-center gap-2 text-sm text-hull-soft">
                  {worst ? <SeverityMark severity={worst} /> : <span className="h-2 w-2 rounded-full bg-starboard" />}
                  {open ? `${open} open finding${open > 1 ? "s" : ""}` : "All clear"}
                </p>
                <p className="text-sm text-hull-soft">
                  {a.lastCycle ? `Last checked ${new Date(a.lastCycle.startedAt).toLocaleString()}` : "Not checked yet"}
                </p>
              </button>
              {a.role !== "viewer" && (
                <button onClick={() => run.mutate(a.metaAccountId)} disabled={run.isPending}
                  className="mt-2 text-sm font-medium text-brass underline-offset-4 hover:underline disabled:opacity-50">
                  Run a check now
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {active && <LockBoard accountId={active} />}
    </div>
  );
}

function LockBoard({ accountId }: { accountId: string }) {
  const ads = useQuery({ queryKey: ["ads", accountId], queryFn: () => api.ads(accountId) });
  if (ads.isLoading) return <p className="text-hull-soft">Loading ads…</p>;
  if (!ads.data?.length) return <p className="text-hull-soft">No ads seen yet. Run a check to take the first snapshot.</p>;

  const features = [...new Set(ads.data.flatMap((a) => Object.keys(a.featuresSpec)))].sort();

  return (
    <section aria-labelledby="lock-board">
      <h2 id="lock-board" className="display text-2xl font-semibold">Enhancement lock board</h2>
      <p className="mb-4 max-w-2xl text-hull-soft">
        What each Advantage+ enhancement is set to now, against the setting you approved. Red means it was switched on without approval.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="text-left align-bottom">
              <th className="sticky left-0 bg-chart py-2 pr-6 font-semibold">Ad</th>
              {features.map((f) => (
                <th key={f} className="w-24 px-2 pb-2 text-center text-xs font-normal leading-tight text-hull-soft first-letter:uppercase">
                  {pretty(f)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-fog/30">
            {ads.data.map((ad) => <AdLockRow key={ad.adId} ad={ad} features={features} />)}
          </tbody>
        </table>
      </div>
      <p className="mt-3 flex flex-wrap gap-5 text-sm text-hull-soft">
        <span className="flex items-center gap-2"><Cell state="off" /> Off, as approved</span>
        <span className="flex items-center gap-2"><Cell state="on" /> On, as approved</span>
        <span className="flex items-center gap-2"><Cell state="drift" /> Switched on without approval</span>
      </p>
    </section>
  );
}

function AdLockRow({ ad, features }: { ad: AdRow; features: string[] }) {
  const worst = SEVERITY_ORDER.find((s) => ad.openFindings.includes(s as Severity));
  return (
    <tr>
      <td className="sticky left-0 bg-chart py-2 pr-6">
        <span className="flex items-center gap-2">
          {worst && <SeverityMark severity={worst} />}
          <span className="font-medium">{ad.adName}</span>
        </span>
        <span className="text-hull-soft">{ad.status.toLowerCase()}</span>
      </td>
      {features.map((f) => {
        const now = isOn(ad.featuresSpec[f]);
        const was = ad.baseline ? isOn(ad.baseline[f]) : now;
        const state = now && !was ? "drift" : now ? "on" : "off";
        return (
          <td key={f} className="px-2 text-center" title={`${pretty(f)}: ${ad.featuresSpec[f] ?? "unset"} (approved ${ad.baseline?.[f] ?? "unknown"})`}>
            <Cell state={state} />
          </td>
        );
      })}
    </tr>
  );
}

function Cell({ state }: { state: "on" | "off" | "drift" }) {
  const cls = state === "drift" ? "bg-port border-port" : state === "on" ? "bg-hull border-hull" : "bg-transparent border-fog";
  return <span aria-label={state} className={`inline-block h-3.5 w-3.5 rounded-[3px] border-2 ${cls}`} />;
}
