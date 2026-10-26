import { useEffect, useState } from "react";

interface FindingRow {
  id: string;
  adId: string;
  code: string;
  severity: string;
  confidence: number;
  summary: string;
  status: string;
  createdAt: string;
}

const sevColor: Record<string, string> = {
  critical: "bg-red-600",
  high: "bg-orange-500",
  medium: "bg-amber-400",
  low: "bg-slate-400",
};

export function App() {
  const [findings, setFindings] = useState<FindingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/findings")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setFindings)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-4xl p-6 font-sans text-slate-900">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Keel</h1>
        <p className="text-slate-500">Keeps your brand steady while Meta's AI steers your ads.</p>
      </header>

      <h2 className="mb-2 text-lg font-medium">Findings</h2>
      {error && <p className="text-red-600">Couldn't load findings: {error}</p>}
      {!findings && !error && <p className="text-slate-500">Loading…</p>}
      {findings?.length === 0 && <p className="text-slate-500">No findings yet. Run a cycle with <code>npm run cycle:once</code>.</p>}
      <ul className="divide-y divide-slate-200">
        {findings?.map((f) => (
          <li key={f.id} className="flex items-start gap-3 py-3">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${sevColor[f.severity] ?? "bg-slate-400"}`} />
            <div className="min-w-0">
              <p className="font-medium">{f.summary}</p>
              <p className="text-sm text-slate-500">
                {f.code} · ad {f.adId} · {(f.confidence * 100).toFixed(0)}% · {f.status}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
