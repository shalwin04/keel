import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";

export function Audit() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: api.audit, refetchInterval: 30_000 });
  if (audit.isLoading) return <p className="text-hull-soft">Loading the audit log…</p>;
  if (audit.isError) return <p role="alert" className="text-port">Couldn't load the audit log: {String(audit.error)}</p>;
  const { verified, brokenAt, entries } = audit.data!;

  return (
    <div className="max-w-4xl">
      <h1 className="display text-3xl font-semibold">Audit log</h1>
      <p className="mt-1 max-w-2xl text-hull-soft">
        Every check, decision and change, in order. Each entry is hashed together with the one before it, so any edit to history breaks the chain.
      </p>
      <p className={`mt-4 inline-flex items-center gap-2 font-medium ${verified ? "text-starboard" : "text-port"}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${verified ? "bg-starboard" : "bg-port"}`} />
        {verified ? "Chain verified: no entry has been altered" : `Chain broken at entry ${brokenAt}`}
      </p>
      <table className="mt-6 w-full text-sm">
        <thead className="text-left text-hull-soft">
          <tr><th className="py-2 font-normal">When</th><th className="font-normal">Who</th><th className="font-normal">What</th><th className="font-normal">Hash</th></tr>
        </thead>
        <tbody className="divide-y divide-fog/30">
          {entries.map((e) => (
            <tr key={e.seq} className="align-top">
              <td className="whitespace-nowrap py-2 pr-4">{new Date(e.at).toLocaleString()}</td>
              <td className="pr-4">{e.actorName}</td>
              <td className="pr-4">
                <p className="font-medium">{e.event.replaceAll(".", " ").replaceAll("_", " ")}</p>
                <p className="max-w-md truncate text-hull-soft">{JSON.stringify(e.payload)}</p>
              </td>
              <td className="text-hull-soft" title={e.hash}>{e.hash.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
