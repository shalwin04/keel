import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Command } from "@langchain/langgraph";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ActionSchema, canDecide, type Approval } from "@keel/core";
import { draftRulebook, loadImage, type createRuntime } from "@keel/agents";
import { decrypt, schema, seedDemo, verifyChain } from "@keel/db";
import { REPO_ROOT, config } from "@keel/meta";
import { accessTo, accountsFor } from "./access.ts";
import type { AppEnv } from "./env.ts";
import type { createEventHub } from "./events.ts";

type Runtime = Awaited<ReturnType<typeof createRuntime>>;
type Hub = Awaited<ReturnType<typeof createEventHub>>;

const DecisionBody = z.object({ decision: z.enum(["approve", "reject", "replace"]) });
const AddAccountBody = z.object({ metaAccountId: z.string().startsWith("act_"), name: z.string().min(1), brandName: z.string().min(1) });
const DraftBody = z.object({ brandId: z.string(), adImageUrls: z.array(z.string().url()).min(1).max(10), guidelines: z.string().optional() });
const PushBody = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });

const MEDIA_ROOTS = [resolve(REPO_ROOT, "eval/fixtures"), resolve(REPO_ROOT, ".data/media")];
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };

export function apiRoutes(rt: Runtime, hub: Hub) {
  const { db } = rt;
  const r = new Hono<AppEnv>();

  r.get("/me", async (c) => {
    const user = c.get("user");
    const accounts = await accountsFor(db, user.id);
    return c.json({ user, accounts });
  });

  // ── Review queue ───────────────────────────────────────────────────────────
  r.get("/queue", async (c) => {
    const status = c.req.query("status") ?? "pending";
    const ids = (await accountsFor(db, c.get("user").id)).map((a) => a.metaAccountId);
    if (!ids.length) return c.json([]);
    const proposals = await db.select().from(schema.proposals)
      .where(and(inArray(schema.proposals.accountId, ids), eq(schema.proposals.status, status), eq(schema.proposals.requiresApproval, true)))
      .orderBy(desc(schema.proposals.createdAt)).limit(100);
    const findingIds = proposals.flatMap((p) => p.findingIds as string[]);
    const findings = findingIds.length ? await db.select().from(schema.findings).where(inArray(schema.findings.id, findingIds)) : [];
    const adIds = [...new Set(proposals.map((p) => p.adId))];
    const snaps = adIds.length ? await db.select({ adId: schema.snapshots.adId, adName: schema.snapshots.adName })
      .from(schema.snapshots).where(inArray(schema.snapshots.adId, adIds)) : [];
    return c.json(proposals.map((p) => ({
      ...p,
      adName: snaps.find((s) => s.adId === p.adId)?.adName ?? p.adId,
      findings: findings.filter((f) => (p.findingIds as string[]).includes(f.id)),
    })));
  });

  r.post("/proposals/:id/decision", async (c) => {
    const user = c.get("user");
    const body = DecisionBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "decision must be approve, reject or replace" }, 400);

    const [p] = await db.select().from(schema.proposals).where(eq(schema.proposals.id, c.req.param("id")));
    if (!p) return c.json({ error: "not found" }, 404);
    const access = await accessTo(db, user.id, p.accountId);
    if (!access) return c.json({ error: "not found" }, 404);
    if (p.status !== "pending") return c.json({ error: `already ${p.status}` }, 409);
    if (p.expiresAt < new Date()) {
      await db.update(schema.proposals).set({ status: "expired" }).where(eq(schema.proposals.id, p.id));
      return c.json({ error: "expired" }, 409);
    }
    const action = ActionSchema.parse(p.action);
    // Anyone touring the demo may try decisions; they are simulated and change no real ad.
    if (!access.isDemo && !canDecide(access.role, action, body.data.decision)) {
      return c.json({ error: `a ${access.role} can't ${body.data.decision} ${action}` }, 403);
    }

    // Claim the proposal first so a double click can't resume the cycle twice.
    const claimed = await db.update(schema.proposals).set({ status: "deciding" })
      .where(and(eq(schema.proposals.id, p.id), eq(schema.proposals.status, "pending"))).returning({ id: schema.proposals.id });
    if (!claimed.length) return c.json({ error: "already being decided" }, 409);

    const decision = body.data.decision;
    const status = decision === "approve" ? "approved" : decision === "replace" ? "replaced" : "rejected";
    await db.insert(schema.approvals).values({ id: randomUUID(), proposalId: p.id, channel: "web", decidedBy: user.id, decision });

    // The seeded demo workspace has no live cycle behind it: record the decision and simulate the outcome.
    if (access.isDemo) {
      await db.update(schema.proposals).set({ status }).where(eq(schema.proposals.id, p.id));
      if (decision !== "reject") await db.update(schema.findings).set({ status: "resolved" }).where(inArray(schema.findings.id, p.findingIds as string[]));
      await rt.audit(user.id, `proposal.${decision}`, { proposalId: p.id, channel: "web", simulated: true });
      const at = () => new Date().toISOString();
      await rt.deps.emit?.({ cycleId: p.cycleId, kind: "decision", node: "requestApproval", at: at(), data: { proposalId: p.id, decision, by: user.id } });
      if (decision !== "reject") {
        await rt.deps.emit?.({ cycleId: p.cycleId, kind: "action", node: "act", at: at(), data: { proposalId: p.id, action: p.action, ok: true, detail: "simulated in the demo workspace" } });
      }
      return c.json({ ok: true, cycleId: p.cycleId, simulated: true }, 202);
    }

    // A real cycle must still be paused at the approval step.
    const cfg = { configurable: { thread_id: p.cycleId } };
    const state = await rt.graph.getState(cfg);
    if (!state.next.includes("requestApproval")) {
      await db.update(schema.proposals).set({ status: "stale" }).where(eq(schema.proposals.id, p.id));
      return c.json({ error: "this check is no longer waiting for a decision" }, 409);
    }
    const approval: Approval = { proposalId: p.id, decision, decidedBy: user.id, channel: "web" };
    void rt.graph.invoke(new Command({ resume: approval }), cfg).catch((err) => console.error("resume failed", err));
    return c.json({ ok: true, cycleId: p.cycleId }, 202);
  });

  /** Puts the shared demo workspace back to its starting state. */
  r.post("/demo/reset", async (c) => {
    const accounts = await accountsFor(db, c.get("user").id);
    if (!accounts.some((a) => a.isDemo)) return c.json({ error: "not in the demo workspace" }, 403);
    return c.json(await seedDemo(db));
  });

  // ── Accounts, health and the lock board ────────────────────────────────────
  r.get("/accounts", async (c) => {
    const accounts = await accountsFor(db, c.get("user").id);
    const ids = accounts.map((a) => a.metaAccountId);
    const open = ids.length ? await db.select({ accountId: schema.findings.accountId, severity: schema.findings.severity })
      .from(schema.findings).where(and(inArray(schema.findings.accountId, ids), eq(schema.findings.status, "open"))) : [];
    const lastCycles = ids.length ? await db.select().from(schema.cycles).where(inArray(schema.cycles.accountId, ids)).orderBy(desc(schema.cycles.startedAt)) : [];
    return c.json(accounts.map((a) => ({
      ...a,
      openBySeverity: open.filter((f) => f.accountId === a.metaAccountId).reduce<Record<string, number>>((m, f) => ({ ...m, [f.severity]: (m[f.severity] ?? 0) + 1 }), {}),
      lastCycle: lastCycles.find((cy) => cy.accountId === a.metaAccountId) ?? null,
    })));
  });

  r.get("/accounts/:id/ads", async (c) => {
    const id = c.req.param("id");
    if (!(await accessTo(db, c.get("user").id, id))) return c.json({ error: "not found" }, 404);
    const snaps = await db.select().from(schema.snapshots).where(eq(schema.snapshots.accountId, id)).orderBy(desc(schema.snapshots.takenAt)).limit(500);
    // Snapshots are newest first, so the first one per ad is its current state.
    const latestPerAd = [...new Set(snaps.map((s) => s.adId))].map((adId) => snaps.find((s) => s.adId === adId)!);
    const creativeIds = latestPerAd.map((s) => s.creativeId);
    const baselines = creativeIds.length ? await db.select().from(schema.creativeBaselines).where(inArray(schema.creativeBaselines.creativeId, creativeIds)) : [];
    const open = await db.select({ adId: schema.findings.adId, severity: schema.findings.severity })
      .from(schema.findings).where(and(eq(schema.findings.accountId, id), eq(schema.findings.status, "open")));
    return c.json(latestPerAd.map((s) => ({
      adId: s.adId, adName: s.adName, status: s.status, creativeId: s.creativeId, originalRef: s.originalRef,
      featuresSpec: s.featuresSpec, baseline: baselines.find((b) => b.creativeId === s.creativeId)?.featuresSpec ?? null,
      openFindings: open.filter((f) => f.adId === s.adId).map((f) => f.severity),
      takenAt: s.takenAt,
    })));
  });

  r.post("/accounts/:id/cycles", async (c) => {
    const id = c.req.param("id");
    const access = await accessTo(db, c.get("user").id, id);
    if (!access || access.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const cycleId = randomUUID();
    void rt.runCycle(id, cycleId).catch((err) => console.error("cycle failed", err));
    return c.json({ cycleId }, 202);
  });

  // ── Cycles and the live trace ──────────────────────────────────────────────
  r.get("/cycles", async (c) => {
    const ids = (await accountsFor(db, c.get("user").id)).map((a) => a.metaAccountId);
    if (!ids.length) return c.json([]);
    return c.json(await db.select().from(schema.cycles).where(inArray(schema.cycles.accountId, ids)).orderBy(desc(schema.cycles.startedAt)).limit(50));
  });

  r.get("/cycles/:id/trace", async (c) => {
    const [cy] = await db.select().from(schema.cycles).where(eq(schema.cycles.id, c.req.param("id")));
    if (!cy || !(await accessTo(db, c.get("user").id, cy.accountId))) return c.json({ error: "not found" }, 404);
    const events = await db.select().from(schema.traceEvents).where(eq(schema.traceEvents.cycleId, cy.id)).orderBy(asc(schema.traceEvents.seq));
    return c.json({ cycle: cy, events });
  });

  /** Server-sent events: live trace + new findings for every account the user can see. */
  r.get("/events", async (c) => {
    const accounts = new Set((await accountsFor(db, c.get("user").id)).map((a) => a.metaAccountId));
    return streamSSE(c, async (stream) => {
      const off = hub.add({ accounts, send: (e) => void stream.writeSSE({ event: e.kind, data: JSON.stringify(e) }) });
      stream.onAbort(() => { off(); });
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(25_000);
      }
    });
  });

  // ── Audit ──────────────────────────────────────────────────────────────────
  r.get("/audit", async (c) => {
    const all = await db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.seq)).limit(5000);
    const brokenAt = verifyChain(all);
    const recent = all.slice(-200).reverse();
    const actorIds = [...new Set(recent.map((e) => e.actor))];
    const people = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, actorIds));
    return c.json({
      verified: brokenAt === -1,
      brokenAt: brokenAt === -1 ? null : all[brokenAt]?.seq ?? null,
      entries: recent.map((e) => ({ ...e, actorName: e.actor === "keel" ? "Keel" : people.find((p) => p.id === e.actor)?.name ?? e.actor })),
    });
  });

  // ── Onboarding ─────────────────────────────────────────────────────────────
  r.get("/meta/adaccounts", async (c) => {
    const user = c.get("user");
    const [conn] = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.userId, user.id)).orderBy(desc(schema.metaConnections.createdAt)).limit(1);
    if (!conn) return c.json({ error: "connect Meta first" }, 409);
    const res = await fetch(`https://graph.facebook.com/${config.graph.version}/me/adaccounts?fields=id,name,account_status&access_token=${encodeURIComponent(decrypt(conn.tokenEnc))}`);
    return c.json(await res.json());
  });

  r.post("/accounts", async (c) => {
    const user = c.get("user");
    const body = AddAccountBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.message }, 400);
    const [owner] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.role, "owner")));
    if (!owner) return c.json({ error: "only workspace owners can add accounts" }, 403);
    const [conn] = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.userId, user.id)).orderBy(desc(schema.metaConnections.createdAt)).limit(1);
    const brandId = randomUUID();
    await db.insert(schema.brands).values({ id: brandId, workspaceId: owner.workspaceId, name: body.data.brandName, policy: {} });
    await db.insert(schema.adAccounts).values({ id: randomUUID(), brandId, metaAccountId: body.data.metaAccountId, name: body.data.name, connectionId: conn?.id });
    await rt.audit(user.id, "account.connected", { metaAccountId: body.data.metaAccountId });
    return c.json({ brandId }, 201);
  });

  r.post("/rulebooks/draft", async (c) => {
    const user = c.get("user");
    const body = DraftBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.message }, 400);
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, body.data.brandId));
    if (!brand) return c.json({ error: "not found" }, 404);
    const rules = await draftRulebook(brand.name, await Promise.all(body.data.adImageUrls.map(async (u) => ({ image: await loadImage(u) }))), body.data.guidelines);
    const [prev] = await db.select().from(schema.rulebooks).where(eq(schema.rulebooks.brandId, brand.id)).orderBy(desc(schema.rulebooks.version)).limit(1);
    const version = (prev?.version ?? 0) + 1;
    await db.insert(schema.rulebooks).values({ id: randomUUID(), brandId: brand.id, version, rules: { ...rules, version }, sourceAds: body.data.adImageUrls, createdBy: user.id });
    return c.json({ ...rules, version }, 201);
  });

  r.get("/brands/:id/rulebook", async (c) => {
    const [rb] = await db.select().from(schema.rulebooks).where(eq(schema.rulebooks.brandId, c.req.param("id"))).orderBy(desc(schema.rulebooks.version)).limit(1);
    return rb ? c.json(rb) : c.json({ error: "no rulebook yet" }, 404);
  });

  // ── Web push ───────────────────────────────────────────────────────────────
  r.get("/push/key", (c) => c.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null }));
  r.post("/push/subscribe", async (c) => {
    const body = PushBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid subscription" }, 400);
    await db.insert(schema.pushSubscriptions).values({ endpoint: body.data.endpoint, keys: body.data.keys, userId: c.get("user").id })
      .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { keys: body.data.keys, userId: c.get("user").id } });
    return c.json({ ok: true });
  });

  // ── Media for review cards ─────────────────────────────────────────────────
  r.get("/media", async (c) => {
    const ref = c.req.query("ref") ?? "";
    if (/^https?:\/\//.test(ref)) return c.redirect(ref);
    if (!ref.startsWith("file://")) return c.json({ error: "bad ref" }, 400);
    const path = resolve(ref.slice(7));
    if (!MEDIA_ROOTS.some((root) => path.startsWith(root + "/"))) return c.json({ error: "forbidden" }, 403);
    const body = await readFile(path).catch(() => null);
    if (!body) return c.json({ error: "not found" }, 404);
    return c.body(body, 200, { "Content-Type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" });
  });

  return r;
}
