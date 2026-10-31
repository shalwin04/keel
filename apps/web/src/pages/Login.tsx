import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api.ts";
import { IconFacebook, Logo } from "../components/Icons.tsx";
import { Button, ErrorNote } from "../components/ui.tsx";

export function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ["auth-options"], queryFn: api.authOptions });
  const [error, setError] = useState<string | null>(new URLSearchParams(location.search).get("error"));
  const [busy, setBusy] = useState<string | null>(null);
  const enter = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); await qc.invalidateQueries(); void navigate({ to: "/" }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-[380px] animate-enter text-center">
        <div className="mx-auto mb-6 w-fit text-ink"><Logo size={56} /></div>
        <h1 className="text-[32px] leading-tight font-semibold">Keel</h1>
        <p className="mx-auto mt-2 max-w-[30ch] text-[17px] text-ink-2">Meta's AI edits your ads. Keel checks its work and fixes it with your OK.</p>

        <div className="mt-10 flex flex-col gap-3">
          {opts.data?.facebook && (
            <a href="/auth/meta/start" className="contents">
              <Button size="lg" className="w-full bg-[#1877f2] text-white hover:brightness-110" icon={<IconFacebook size={18} />}>Continue with Facebook</Button>
            </a>
          )}
          {opts.data?.demo && <Button size="lg" variant={opts.data.facebook ? "secondary" : "primary"} loading={busy === "demo"} className="w-full" onClick={() => enter("demo", api.demoLogin)}>Explore the demo</Button>}
          {opts.data?.dev && <Button size="lg" variant="secondary" loading={busy === "dev"} className="w-full" onClick={() => enter("dev", api.devLogin)}>Developer sign-in</Button>}
          {opts.isSuccess && !opts.data.facebook && !opts.data.demo && !opts.data.dev && <p className="text-[14px] text-ink-2">Sign-in isn't configured on this server yet.</p>}
        </div>
        {error && <div className="mt-6 text-left"><ErrorNote error={error.replaceAll("-", " ")} /></div>}
        <p className="mt-10 text-[12px] text-ink-3">Keel never changes an ad without a person's approval unless you allow it in Rules.</p>
      </div>
    </div>
  );
}
