import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../api.ts";

export function Onboarding() {
  const qc = useQueryClient();
  const metaAccounts = useQuery({ queryKey: ["meta-adaccounts"], queryFn: api.metaAdAccounts, retry: false });
  const [accountId, setAccountId] = useState("");
  const [brand, setBrand] = useState("");
  const [brandId, setBrandId] = useState<string>();
  const [urls, setUrls] = useState("");
  const [guidelines, setGuidelines] = useState("");

  const add = useMutation({
    mutationFn: () => {
      const acct = metaAccounts.data?.data?.find((a) => a.id === accountId);
      return api.addAccount({ metaAccountId: accountId, name: acct?.name ?? accountId, brandName: brand });
    },
    onSuccess: (r) => { setBrandId(r.brandId); void qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });
  const draft = useMutation({
    mutationFn: () => api.draftRulebook({ brandId: brandId!, adImageUrls: urls.split(/\s+/).filter(Boolean), guidelines: guidelines || undefined }),
  });

  const notConnected = metaAccounts.error instanceof ApiError && metaAccounts.error.status === 409;

  return (
    <div className="max-w-2xl space-y-10">
      <header>
        <h1 className="display text-3xl font-semibold">Connect an ad account</h1>
        <p className="mt-1 text-hull-soft">Three steps. Keel only reads until you approve a change.</p>
      </header>

      <Step n={1} title="Connect Meta" done={!notConnected && metaAccounts.isSuccess}>
        {notConnected || metaAccounts.isError ? (
          <a href="/auth/meta/start" className="inline-block rounded-sm bg-hull px-4 py-2.5 font-medium text-chart">Continue with Facebook</a>
        ) : (
          <p className="text-hull-soft">Connected. Keel can see {metaAccounts.data?.data?.length ?? 0} ad accounts.</p>
        )}
      </Step>

      <Step n={2} title="Choose the account and name the brand" done={!!brandId}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Ad account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1 w-full rounded-sm border border-fog/60 bg-chart px-2 py-2">
              <option value="">Choose…</option>
              {metaAccounts.data?.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Brand name
            <input value={brand} onChange={(e) => setBrand(e.target.value)} className="mt-1 w-full rounded-sm border border-fog/60 bg-chart px-2 py-2" />
          </label>
        </div>
        <button disabled={!accountId || !brand || add.isPending || !!brandId} onClick={() => add.mutate()}
          className="mt-3 rounded-sm bg-hull px-4 py-2.5 font-medium text-chart disabled:opacity-40">
          {brandId ? "Account added" : "Add this account"}
        </button>
        {add.isError && <p role="alert" className="mt-2 text-port">{String(add.error)}</p>}
      </Step>

      <Step n={3} title="Teach Keel your brand" done={draft.isSuccess}>
        <p className="mb-3 text-sm text-hull-soft">Paste image links to 3–10 of your best ads, one per line. Muse Wonder drafts a rulebook from them: who appears, colours, tone, claims you never make.</p>
        <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={4} placeholder="https://…" className="w-full rounded-sm border border-fog/60 bg-chart px-2 py-2 text-sm" />
        <textarea value={guidelines} onChange={(e) => setGuidelines(e.target.value)} rows={3} placeholder="Optional: paste your brand guidelines" className="mt-2 w-full rounded-sm border border-fog/60 bg-chart px-2 py-2 text-sm" />
        <button disabled={!brandId || !urls.trim() || draft.isPending} onClick={() => draft.mutate()}
          className="mt-3 rounded-sm bg-hull px-4 py-2.5 font-medium text-chart disabled:opacity-40">
          {draft.isPending ? "Drafting the rulebook…" : "Draft the rulebook"}
        </button>
        {draft.isError && <p role="alert" className="mt-2 text-port">{String(draft.error)}</p>}
        {draft.data && <pre className="mt-4 max-h-96 overflow-auto rounded-sm bg-chart-deep p-4 text-xs leading-relaxed">{JSON.stringify(draft.data, null, 2)}</pre>}
      </Step>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="flex gap-4">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 font-semibold ${done ? "border-starboard bg-starboard text-white" : "border-hull"}`}>{n}</span>
      <div className="min-w-0 flex-1">
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </section>
  );
}
