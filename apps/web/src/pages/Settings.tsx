import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api.ts";
import { Avatar } from "../components/Shell.tsx";
import { IconBell, IconChevron, IconFacebook, IconLogout, IconShield } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, ErrorNote, Field, Input, List, PageHeader, Pill, Row, SectionTitle, Segmented, Skeleton, relTime } from "../components/ui.tsx";
import { enablePush, pushSupported } from "../push.ts";
import { getTheme, setTheme, type Theme } from "../theme.ts";

export function Settings() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [theme, setT] = useState<Theme>(getTheme());
  const [push, setPush] = useState<string | null>(null);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      {me.isLoading ? <Skeleton className="h-64" /> : me.isError ? <ErrorNote error={me.error} /> : me.data && (
        <div className="space-y-8">
          <section>
            <List>
              <Row title={<span className="flex items-center gap-3"><Avatar name={me.data.user.name} size={36} /><span className="font-medium">{me.data.user.name}</span></span>}>
                <Button size="sm" variant="plain" icon={<IconLogout size={15} />} onClick={async () => { await api.logout(); qc.clear(); void navigate({ to: "/login" }); }}>Sign out</Button>
              </Row>
            </List>
          </section>

          <ConnectAccounts />

          <section>
            <SectionTitle>This device</SectionTitle>
            <List>
              <Row title="Appearance">
                <Segmented label="Appearance" value={theme} onChange={(t) => { setTheme(t); setT(t); }}
                  options={[{ value: "system", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
              </Row>
              <Row title={<span className="flex items-center gap-2"><IconBell size={16} /> Review alerts</span>}
                detail={push === "enabled" ? "On for this device" : push === "denied" ? "Blocked in browser settings" : push === "unavailable" ? "Not available here (needs HTTPS and a server key)" : "Get a notification when something needs you"}>
                {pushSupported() && push !== "enabled" && (
                  <Button size="sm" onClick={async () => { const r = await enablePush().catch(() => "unavailable" as const); setPush(r); if (r === "enabled") toast("Alerts on"); }}>Turn on</Button>
                )}
              </Row>
            </List>
          </section>

          <Members />

          <section>
            <SectionTitle>Trust</SectionTitle>
            <List>
              <Link to="/audit" className="block"><Row title={<span className="flex items-center gap-2"><IconShield size={16} /> Audit log</span>} detail="Every decision and change, hash-chained"><IconChevron size={16} className="text-ink-3" /></Row></Link>
            </List>
          </section>
        </div>
      )}
    </div>
  );
}

/** Facebook connection + picking which ad accounts Keel watches. Also the landing page after Facebook sign-in. */
export function ConnectAccounts({ highlight }: { highlight?: boolean }) {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const opts = useQuery({ queryKey: ["auth-options"], queryFn: api.authOptions });
  const meta = useQuery({ queryKey: ["meta-adaccounts"], queryFn: api.metaAdAccounts, enabled: Boolean(me.data?.metaConnected), retry: false });
  const qc = useQueryClient();
  const toast = useToast();
  const [manual, setManual] = useState({ id: "", brand: "" });
  const owner = me.data?.workspaces.some((w) => w.role === "owner" && !w.isDemo);
  const add = useMutation({
    mutationFn: (b: { metaAccountId: string; name: string; brandName: string }) => api.addAccount(b),
    onSuccess: () => { toast("Keel is watching it. The first check is running now."); void qc.invalidateQueries(); setManual({ id: "", brand: "" }); },
    onError: (e) => toast(e instanceof Error ? e.message : String(e), "error"),
  });
  const watched = me.data?.accounts.filter((a) => !a.isDemo) ?? [];

  return (
    <section>
      <SectionTitle>Ad accounts</SectionTitle>
      <Card className={`space-y-5 p-5 ${highlight ? "ring-2 ring-accent/40" : ""}`}>
        {watched.length > 0 && (
          <ul className="space-y-2">
            {watched.map((a) => (
              <li key={a.metaAccountId} className="flex items-center justify-between gap-3">
                <div className="min-w-0"><div className="truncate font-medium">{a.name}</div><div className="text-[13px] text-ink-2">{a.metaAccountId}</div></div>
                <Pill tone="ok">Watching</Pill>
              </li>
            ))}
          </ul>
        )}

        {me.data?.metaConnected ? (
          <div>
            <div className="mb-3 flex items-center gap-2 text-[14px] text-ink-2">
              <IconFacebook size={16} className="text-[#1877f2]" /> Facebook connected{me.data.metaExpiresAt && ` · renews ${relTime(me.data.metaExpiresAt).replace("in ", "in ")}`}
            </div>
            {meta.isLoading ? <Skeleton className="h-20" /> : meta.isError ? <ErrorNote error={meta.error} /> : (
              <ul className="divide-y divide-[var(--line)] rounded-xl border hairline">
                {(meta.data?.data ?? []).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-medium">{a.name}</div><div className="text-[12px] text-ink-2">{a.id}</div></div>
                    {a.connected ? <Pill tone="ok">Watching</Pill> : (
                      <Button size="sm" variant="primary" disabled={!owner} loading={add.isPending && add.variables?.metaAccountId === a.id}
                        onClick={() => add.mutate({ metaAccountId: a.id, name: a.name, brandName: a.name })}>Watch</Button>
                    )}
                  </li>
                ))}
                {!meta.data?.data?.length && <li className="px-3 py-3 text-[14px] text-ink-2">No ad accounts were shared. Sign in with Facebook again and tick your ad account.</li>}
              </ul>
            )}
          </div>
        ) : opts.data?.facebook ? (
          <a href="/auth/meta/start"><Button variant="primary" icon={<IconFacebook size={16} />}>Connect with Facebook</Button></a>
        ) : null}

        {owner && (
          <details className="group">
            <summary className="cursor-pointer list-none text-[14px] text-accent">Add by account ID (uses the server's system user token)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Ad account ID"><Input placeholder="act_1234567890" value={manual.id} onChange={(e) => setManual({ ...manual, id: e.target.value.trim() })} /></Field>
              <Field label="Brand"><Input placeholder="Northline Apparel" value={manual.brand} onChange={(e) => setManual({ ...manual, brand: e.target.value })} /></Field>
              <Button variant="primary" disabled={!/^act_\d+$/.test(manual.id) || !manual.brand} loading={add.isPending}
                onClick={() => add.mutate({ metaAccountId: manual.id, name: manual.brand, brandName: manual.brand })}>Add</Button>
            </div>
          </details>
        )}
        {!owner && <p className="text-[13px] text-ink-2">Only workspace owners can add accounts.</p>}
      </Card>
    </section>
  );
}

function Members() {
  const m = useQuery({ queryKey: ["members"], queryFn: api.members });
  const rows = (m.data ?? []).filter((x) => !x.isDemo);
  if (!rows.length) return null;
  return (
    <section>
      <SectionTitle>People</SectionTitle>
      <List>
        {rows.map((x) => (
          <Row key={x.workspaceId + x.userId} title={<span className="flex items-center gap-3"><Avatar name={x.name} />{x.name}</span>} detail={x.workspace}>
            <Pill className="capitalize">{x.role}</Pill>
          </Row>
        ))}
      </List>
    </section>
  );
}
