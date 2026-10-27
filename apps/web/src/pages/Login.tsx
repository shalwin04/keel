import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api.ts";

export function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const enter = async (fn: () => Promise<unknown>) => {
    try { await fn(); await qc.invalidateQueries(); void navigate({ to: "/" }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="grid min-h-screen md:grid-cols-[1.1fr_1fr]">
      <section className="flex flex-col justify-between bg-hull px-8 py-10 text-chart md:px-14 md:py-14">
        <img src="/icon.svg" alt="Keel" className="h-10 w-10" />
        <div className="max-w-lg">
          <h1 className="display text-5xl font-semibold leading-[1.02] md:text-6xl">Meta's AI is editing your ads. Check its work.</h1>
          <p className="mt-6 max-w-md text-lg text-chart/80">
            Keel watches every ad variant Meta serves, catches the ones that drift off-brand, and waits for your call before it changes anything.
          </p>
        </div>
        <p className="text-sm text-chart/60">Built for the Meta Global AI Developer Hackathon 2026.</p>
      </section>
      <section className="flex flex-col justify-center gap-4 px-8 py-12 md:px-16">
        <h2 className="display text-2xl font-semibold">Sign in to Keel Bridge</h2>
        <a href="/auth/meta/start" className="rounded-sm bg-hull px-5 py-3 text-center font-medium text-chart hover:bg-hull/90">
          Continue with Facebook
        </a>
        <p className="text-sm text-hull-soft">Uses Facebook Login for Business. You choose which ad accounts Keel can see.</p>
        <hr className="my-2 border-fog/40" />
        <button onClick={() => enter(api.demoLogin)} className="rounded-sm border border-hull px-5 py-3 font-medium hover:bg-chart-deep">
          Explore the demo workspace
        </button>
        <p className="text-sm text-hull-soft">Sample findings for a fictional brand. Try every decision; nothing touches a real ad.</p>
        {import.meta.env.DEV && (
          <button onClick={() => enter(api.devLogin)} className="text-left text-sm text-hull-soft underline underline-offset-4">
            Developer sign-in (local only)
          </button>
        )}
        {error && <p role="alert" className="text-port">{error}</p>}
      </section>
    </div>
  );
}
