import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Command } from "@langchain/langgraph";
import { and, asc, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ACTIONS, ActionSchema, DEFAULT_POLICY, RulebookSchema, canDecide, type Approval } from "@keel/core";
import { draftRulebook, loadImage, type createRuntime } from "@keel/agents";
import { decrypt, schema, seedDemo, verifyChain } from "@keel/db";
import { MIME, REPO_ROOT, config, mediaDir } from "@keel/meta";
import { accessTo, accountsFor } from "./access.ts";
import type { AppEnv } from "./env.ts";
import type { createEventHub } from "./events.ts";

type Runtime = Awaited<ReturnType<typeof createRuntime>>;
type Hub = Awaited<ReturnType<typeof createEventHub>>;

const DecisionBody = z.object({ decision: z.enum(["approve", "reject", "replace"]) });
const AddAccountBody = z.object({ metaAccountId: z.string().regex(/^act_\d+$/), name: z.string().min(1).max(120), brandName: z.string().min(1).max(120) });
const PatchAccountBody = z.object({ watching: z.boolean().optional(), pollIntervalMin: z.number().int().min(15).max(1440).optional() });
const DraftBody = z.object({ brandId: z.string(), adImageUrls: z.array(z.string().url()).min(1).max(10), guidelines: z.string().max(20_000).optional() });
const PolicyBody = z.object({
  autoActions: z.array(z.enum(ACTIONS)).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  approvalTtlHours: z.number().min(1).max(168).optional(),
});
const PushBody = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });

const DONE = ["executed", "failed", "rejected", "expired", "stale", "approved"];

export function apiRoutes(rt: Runtime, hub: Hub) {
  const { db } = rt;
  const r = new Hono<AppEnv>();
  const mediaRoots = () => [resolve(REPO_ROOT, "eval/fixtures"), mediaDir(), resolve(REPO_ROOT, ".data/media")];
  const accountIds = async (userId: string) => (await accountsFor(db, userId)).map((a) => a.metaAccountId);

  r.get("/me", async (c) => {
    const user = c.get("user");
    const accounts = await accountsFor(db, user.id);
    const workspaces = await db.select({ id: schema.workspaces.id, name: schema.workspaces.name, isDemo: schema.workspaces.isDemo, role: schema.memberships.role })
      .from(schema.memberships).innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
      .where(eq(schema.memberships.userId, user.id));
    const [conn] = await db.select({ id: schema.metaConnections.id, expiresAt: schema.metaConnections.expiresAt }).from(schema.metaConnections)
      .where(eq(schema.metaConnections.userId, user.id)).orderBy(desc(schema.metaConnections.createdAt)).limit(1);
    return c.json({ user, accounts, workspaces, metaConnected: Boolean(conn), metaExpiresAt: conn?.expiresAt ?? null });
  });

  /** Numbers for the overview strip. */
  r.get("/overview", async (c) => {
    const ids = await accountIds(c.get("user").id);
    if (!ids.length) return c.json({ pending: 0, openFindings: 0, actions7d: 0, cycles24h: 0, ads: 0, costUsd7d: 0, lastCycle: null });
    const since7 = new Date(Date.now() - 7 * 86_400_000), since1 = new Date(Date.now() - 86_400_000);
    const [[pending], [open], [acted], [cy], [ads], [cost], [last]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(schema.proposals).where(and(inArray(schema.proposals.accountId, ids), eq(schema.proposals.status, "pending"))),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.findings).where(and(inArray(schema.findings.accountId, ids), eq(schema.findings.status, "open"))),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.proposals).where(and(inArray(schema.proposals.accountId, ids), eq(schema.proposals.status, "executed"), gt(schema.proposals.createdAt, since7))),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.cycles).where(and(inArray(schema.cycles.accountId, ids), gt(schema.cycles.startedAt, since1))),
      db.select({ n: sql<number>`count(distinct ${schema.snapshots.adId})::int` }).from(schema.snapshots).where(inArray(schema.snapshots.accountId, ids)),
      db.select({ n: sql<number>`coalesce(sum((${schema.traceEvents.data}->>'costUsd')::float), 0)` }).from(schema.traceEvents)
        .innerJoin(schema.cycles, eq(schema.cycles.id, schema.traceEvents.cycleId))
        .where(and(inArray(schema.cycles.accountId, ids), eq(schema.traceEvents.kind, "model_call"), gt(schema.traceEvents.at, since7))),
      db.select().from(schema.cycles).where(inArray(schema.cycles.accountId, ids)).orderBy(desc(schema.cycles.startedAt)).limit(1),
    ]);
    return c.json({ pending: pending?.n ?? 0, openFindings: open?.n ?? 0, actions7d: acted?.n ?? 0, cycles24h: cy?.n ?? 0, ads: ads?.n ?? 0, costUsd7d: cost?.n ?? 0, lastCycle: last ?? null });
  });

  // ── Review queue ───────────────────────────────────────────────────────────
  r.get("/queue", async (c) => {
    const status = c.req.query("status") ?? "pending";
    const ids = await accountIds(c.get("user").id);
    if (!ids.length) return c.json([]);
    const statusFilter = status === "history" ? inArray(schema.proposals.status, DONE) : eq(schema.proposals.status, status);
    const proposals = await db.select().from(schema.proposals)
      .where(and(inArray(schema.proposals.accountId, ids), statusFilter, eq(schema.proposals.requiresApproval, true)))
      .orderBy(desc(schema.proposals.createdAt)).limit(status === "history" ? 50 : 100);
    const findingIds = proposals.flatMap((p) => p.findingIds as string[]);
    const findings = findingIds.length ? await db.select().from(schema.findings).where(inArray(schema.findings.id, findingIds)) : [];
    const adIds = [...new Set(proposals.map((p) => p.adId))];
    const snaps = adIds.length ? await db.select({ adId: schema.snapshots.adId, adName: schema.snapshots.adName, takenAt: schema.snapshots.takenAt })
      .from(schema.snapshots).where(inArray(schema.snapshots.adId, adIds)).orderBy(desc(schema.snapshots.takenAt)) : [];
    const decisions = proposals.length ? await db.select({ proposalId: schema.approvals.proposalId, decision: schema.approvals.decision, decidedAt: schema.approvals.decidedAt, name: schema.users.name })
      .from(schema.approvals).innerJoin(schema.users, eq(schema.users.id, schema.approvals.decidedBy))
      .where(inArray(schema.approvals.proposalId, proposals.map((p) => p.id))) : [];
    const accounts = await accountsFor(db, c.get("user").id);
    return c.json(proposals.map((p) => ({
      ...p,
      adName: snaps.find((s) => s.adId === p.adId)?.adName ?? p.adId,
      accountName: accounts.find((a) => a.metaAccountId === p.accountId)?.name ?? p.accountId,
      decision: decisions.find((d) => d.proposalId === p.id) ?? null,
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
      return c.json({ error: "this request expired" }, 409);
    }
    const action = ActionSchema.parse(p.action);
    // Anyone touring the demo may try decisions; they are simulated and change no real ad.
    if (!access.isDemo && !canDecide(access.role, action, body.data.decision)) {
      return c.json({ error: `a ${access.role} can't ${body.data.decision} this` }, 403);
    }

    // Claim the proposal first so a double click can't resume the cycle twice.
    const claimed = await db.update(schema.proposals).set({ status: "deciding" })
      .where(and(eq(schema.proposals.id, p.id), eq(schema.proposals.status, "pending"))).returning({ id: schema.proposals.id });
    if (!claimed.length) return c.json({ error: "already being decided" }, 409);

    const decision = body.data.decision;
    await db.insert(schema.approvals).values({ id: randomUUID(), proposalId: p.id, channel: "web", decidedBy: user.id, decision });

    // The seeded demo workspace has no live cycle behind it: record the decision and simulate the outcome.
    if (access.isDemo) {
      const status = decision === "reject" ? "rejected" : "executed";
      await db.update(schema.proposals).set({ status, outcome: decision === "reject" ? null : { executed: { ok: true, detail: "simulated in the demo workspace" }, verified: { ok: true, detail: "simulated" } } }).where(eq(schema.proposals.id, p.id));
      await db.update(schema.findings).set({ status: decision === "reject" ? "dismissed" : "resolved" }).where(inArray(schema.findings.id, p.findingIds as string[]));
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
    await db.update(schema.cycles).set({ status: "running" }).where(eq(schema.cycles.id, p.cycleId));
    void rt.graph.invoke(new Command({ resume: approval }), cfg).catch(async (err) => {
      console.error("[keel] resume failed", err);
      await db.update(schema.proposals).set({ status: "failed", outcome: { executed: { ok: false, detail: String((err as Error).message) } } }).where(eq(schema.proposals.id, p.id));
    });
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
    if (!ids.length) return c.json([]);
    const [open, lastCycles, rows, adCounts] = await Promise.all([
      db.select({ accountId: schema.findings.accountId, severity: schema.findings.severity })
        .from(schema.findings).where(and(inArray(schema.findings.accountId, ids), eq(schema.findings.status, "open"))),
      db.select().from(schema.cycles).where(inArray(schema.cycles.accountId, ids)).orderBy(desc(schema.cycles.startedAt)).limit(200),
      db.select().from(schema.adAccounts).where(inArray(schema.adAccounts.metaAccountId, ids)),
      db.select({ accountId: schema.snapshots.accountId, n: sql<number>`count(distinct ${schema.snapshots.adId})::int` }).from(schema.snapshots)
        .where(inArray(schema.snapshots.accountId, ids)).groupBy(schema.snapshots.accountId),
    ]);
    return c.json(accounts.map((a) => {
      const row = rows.find((x) => x.metaAccountId === a.metaAccountId);
      return {
        ...a,
        watching: row?.watching ?? true,
        pollIntervalMin: row?.pollIntervalMin ?? 180,
        ads: adCounts.find((x) => x.accountId === a.metaAccountId)?.n ?? 0,
        openBySeverity: open.filter((f) => f.accountId === a.metaAccountId).reduce<Record<string, number>>((m, f) => ({ ...m, [f.severity]: (m[f.severity] ?? 0) + 1 }), {}),
        lastCycle: lastCycles.find((cy) => cy.accountId === a.metaAccountId) ?? null,
      };
    }));
  });

  r.get("/accounts/:id/ads", async (c) => {
    const id = c.req.param("id");
    if (!(await accessTo(db, c.get("user").id, id))) return c.json({ error: "not found" }, 404);
    const snaps = await db.select().from(schema.snapshots).where(eq(schema.snapshots.accountId, id)).orderBy(desc(schema.snapshots.takenAt)).limit(500);
    // Snapshots are newest first, so the first one per ad is its current state.
    const latestPerAd = [...new Set(snaps.map((s) => s.adId))].map((adId) => snaps.find((s) => s.adId === adId)!);
    const adIds = latestPerAd.map((s) => s.adId);
    const baselines = adIds.length ? await db.select().from(schema.creativeBaselines).where(inArray(schema.creativeBaselines.adId, adIds)).orderBy(desc(schema.creativeBaselines.lockedAt)) : [];
    const open = await db.select({ adId: schema.findings.adId, severity: schema.findings.severity })
      .from(schema.findings).where(and(eq(schema.findings.accountId, id), eq(schema.findings.status, "open")));
    return c.json(latestPerAd.map((s) => {
      const b = baselines.find((x) => x.adId === s.adId);
      // Keel swapped in a new creative after this snapshot: show what Meta now serves (re-read on the next check).
      const changedByKeel = Boolean(b && b.lockedAt > s.takenAt && b.creativeId !== s.creativeId);
      return {
        adId: s.adId, adName: s.adName, status: s.status, creativeId: changedByKeel ? b!.creativeId : s.creativeId, originalRef: s.originalRef,
        featuresSpec: changedByKeel ? b!.featuresSpec : s.featuresSpec, baseline: b?.featuresSpec ?? null, changedByKeel, baselineLockedAt: b?.lockedAt ?? null, baselineLockedBy: b?.lockedBy ?? null,
        variants: (s.variants as unknown[]).length,
        openFindings: open.filter((f) => f.adId === s.adId).map((f) => f.severity),
        takenAt: s.takenAt,
      };
    }));
  });

  r.patch("/accounts/:id", async (c) => {
    const id = c.req.param("id");
    const access = await accessTo(db, c.get("user").id, id);
    if (!access || access.role !== "owner") return c.json({ error: "only owners can change this" }, 403);
    const body = PatchAccountBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.message }, 400);
    await db.update(schema.adAccounts).set(body.data).where(eq(schema.adAccounts.metaAccountId, id));
    await rt.audit(c.get("user").id, "account.updated", { metaAccountId: id, ...body.data });
    return c.json({ ok: true });
  });

  r.post("/accounts/:id/cycles", async (c) => {
    const id = c.req.param("id");
    const access = await accessTo(db, c.get("user").id, id);
    if (!access || access.role === "viewer") return c.json({ error: "viewers can't start checks" }, 403);
    if (access.isDemo) return c.json({ error: "the demo workspace has no live ad account" }, 409);
    const [busy] = await db.select({ id: schema.cycles.id }).from(schema.cycles)
      .where(and(eq(schema.cycles.accountId, id), inArray(schema.cycles.status, ["running"]), gt(schema.cycles.startedAt, new Date(Date.now() - 30 * 60_000)))).limit(1);
    if (busy) return c.json({ error: "a check is already running", cycleId: busy.id }, 409);
    const cycleId = randomUUID();
    void rt.runCycle(id, cycleId).catch((err) => console.error("[keel] cycle failed", err));
    return c.json({ cycleId }, 202);
  });

  // ── Cycles and the live trace ──────────────────────────────────────────────
  r.get("/cycles", async (c) => {
    const ids = await accountIds(c.get("user").id);
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
    const accounts = new Set(await accountIds(c.get("user").id));
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
    const user = c.get("user");
    const accounts = await accountsFor(db, user.id);
    const all = await db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.seq)).limit(20_000);
    const brokenAt = verifyChain(all);
    // The chain is global; each person sees entries about their own accounts and their own actions.
    const mine = new Set(accounts.map((a) => a.metaAccountId));
    const visible = all.filter((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return e.actor === user.id || (typeof p.metaAccountId === "string" && mine.has(p.metaAccountId)) || (typeof p.accountId === "string" && mine.has(p.accountId)) || (!p.metaAccountId && !p.accountId);
    });
    const recent = visible.slice(-300).reverse();
    const actorIds = [...new Set(recent.map((e) => e.actor))];
    const people = actorIds.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, actorIds)) : [];
    return c.json({
      verified: brokenAt === -1,
      total: all.length,
      brokenAt: brokenAt === -1 ? null : all[brokenAt]?.seq ?? null,
      entries: recent.map((e) => ({ ...e, actorName: e.actor.startsWith("keel") ? "Keel" : people.find((p) => p.id === e.actor)?.name ?? e.actor })),
    });
  });

  // ── Brands: rulebook and policy ────────────────────────────────────────────
  r.get("/brands", async (c) => {
    const accounts = await accountsFor(db, c.get("user").id);
    const brandIds = [...new Set(accounts.map((a) => a.brandId))];
    if (!brandIds.length) return c.json([]);
    const brands = await db.select().from(schema.brands).where(inArray(schema.brands.id, brandIds));
    const books = await db.select().from(schema.rulebooks).where(inArray(schema.rulebooks.brandId, brandIds)).orderBy(desc(schema.rulebooks.version));
    const dismissed = await db.select({ accountId: schema.findings.accountId, n: sql<number>`count(*)::int` }).from(schema.findings)
      .where(and(inArray(schema.findings.accountId, accounts.map((a) => a.metaAccountId)), eq(schema.findings.status, "dismissed"))).groupBy(schema.findings.accountId);
    return c.json(brands.map((b) => {
      const acc = accounts.filter((a) => a.brandId === b.id);
      return {
        id: b.id, name: b.name,
        role: acc[0]?.role ?? "viewer",
        isDemo: acc.some((a) => a.isDemo),
        accounts: acc.map((a) => ({ metaAccountId: a.metaAccountId, name: a.name })),
        policy: { ...DEFAULT_POLICY, ...(b.policy as object) },
        rulebook: books.find((x) => x.brandId === b.id) ?? null,
        learned: dismissed.filter((d) => acc.some((a) => a.metaAccountId === d.accountId)).reduce((n, d) => n + d.n, 0),
      };
    }));
  });

  async function brandRole(userId: string, brandId: string) {
    const acc = (await accountsFor(db, userId)).filter((a) => a.brandId === brandId);
    if (acc.length) return acc[0]!.role;
    // A brand with no account yet: owner of its workspace.
    const [b] = await db.select({ ws: schema.brands.workspaceId }).from(schema.brands).where(eq(schema.brands.id, brandId));
    if (!b) return undefined;
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.workspaceId, b.ws), eq(schema.memberships.userId, userId)));
    return m?.role;
  }

  r.get("/brands/:id/rulebook", async (c) => {
    if (!(await brandRole(c.get("user").id, c.req.param("id")))) return c.json({ error: "not found" }, 404);
    const [rb] = await db.select().from(schema.rulebooks).where(eq(schema.rulebooks.brandId, c.req.param("id"))).orderBy(desc(schema.rulebooks.version)).limit(1);
    return rb ? c.json(rb) : c.json({ error: "no rulebook yet" }, 404);
  });

  r.put("/brands/:id/rulebook", async (c) => {
    const user = c.get("user");
    const brandId = c.req.param("id");
    const role = await brandRole(user.id, brandId);
    if (role !== "owner") return c.json({ error: "only owners can edit the rulebook" }, 403);
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
    const parsed = RulebookSchema.safeParse({ ...(await c.req.json().catch(() => ({}))), brand: brand!.name, version: 0 });
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    const [prev] = await db.select().from(schema.rulebooks).where(eq(schema.rulebooks.brandId, brandId)).orderBy(desc(schema.rulebooks.version)).limit(1);
    const version = (prev?.version ?? 0) + 1;
    const rules = { ...parsed.data, version };
    await db.insert(schema.rulebooks).values({ id: randomUUID(), brandId, version, rules, sourceAds: prev?.sourceAds ?? [], createdBy: user.id });
    await rt.audit(user.id, "rulebook.updated", { brandId, version });
    return c.json(rules, 201);
  });

  r.put("/brands/:id/policy", async (c) => {
    const user = c.get("user");
    const brandId = c.req.param("id");
    if ((await brandRole(user.id, brandId)) !== "owner") return c.json({ error: "only owners can change approvals" }, 403);
    const body = PolicyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.message }, 400);
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
    const policy = { ...(brand!.policy as object), ...body.data };
    await db.update(schema.brands).set({ policy }).where(eq(schema.brands.id, brandId));
    await rt.audit(user.id, "policy.updated", { brandId, ...body.data });
    return c.json({ ...DEFAULT_POLICY, ...policy });
  });

  r.post("/rulebooks/draft", async (c) => {
    const user = c.get("user");
    const body = DraftBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.message }, 400);
    if ((await brandRole(user.id, body.data.brandId)) !== "owner") return c.json({ error: "only owners can draft the rulebook" }, 403);
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, body.data.brandId));
    try {
      const rules = await draftRulebook(brand!.name, await Promise.all(body.data.adImageUrls.map(async (u) => ({ image: await loadImage(u) }))), body.data.guidelines);
      const [prev] = await db.select().from(schema.rulebooks).where(eq(schema.rulebooks.brandId, brand!.id)).orderBy(desc(schema.rulebooks.version)).limit(1);
      const version = (prev?.version ?? 0) + 1;
      await db.insert(schema.rulebooks).values({ id: randomUUID(), brandId: brand!.id, version, rules: { ...rules, version }, sourceAds: body.data.adImageUrls, createdBy: user.id });
      await rt.audit(user.id, "rulebook.drafted", { brandId: brand!.id, version });
      return c.json({ ...rules, version }, 201);
    } catch (err) {
      return c.json({ error: `Muse Wonder couldn't draft it: ${(err as Error).message}` }, 502);
    }
  });

  // ── Onboarding ─────────────────────────────────────────────────────────────
  r.get("/meta/adaccounts", async (c) => {
    const user = c.get("user");
    const [conn] = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.userId, user.id)).orderBy(desc(schema.metaConnections.createdAt)).limit(1);
    if (!conn) return c.json({ error: "connect Meta first" }, 409);
    const res = await fetch(`https://graph.facebook.com/${config.graph.version}/me/adaccounts?fields=id,name,account_status,currency&limit=200&access_token=${encodeURIComponent(decrypt(conn.tokenEnc))}`);
    const json = (await res.json()) as { data?: { id: string; name: string; account_status: number }[]; error?: { message: string } };
    if (json.error) return c.json({ error: json.error.message }, 502);
    // "connected" means this person already watches it; an account registered elsewhere can still be claimed.
    const mine = new Set((await accountsFor(db, user.id)).map((a) => a.metaAccountId));
    return c.json({ data: (json.data ?? []).map((a) => ({ ...a, connected: mine.has(a.id) })) });
  });

  r.post("/accounts", async (c) => {
    const user = c.get("user");
    const body = AddAccountBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Ad account ids look like act_1234567890" }, 400);
    const owned = await db.select({ workspaceId: schema.memberships.workspaceId, isDemo: schema.workspaces.isDemo })
      .from(schema.memberships).innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
      .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.role, "owner")));
    const ws = owned.find((o) => !o.isDemo);
    if (!ws) return c.json({ error: "only workspace owners can add accounts" }, 403);
    const id = body.data.metaAccountId;
    if ((await accountsFor(db, user.id)).some((a) => a.metaAccountId === id)) return c.json({ error: "You already watch this account" }, 409);
    const [conn] = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.userId, user.id)).orderBy(desc(schema.metaConnections.createdAt)).limit(1);
    const [exists] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.metaAccountId, id));
    // Registered under another workspace (e.g. by the dev script): whoever can prove Meta access may claim it.
    if (exists) {
      if (!conn) return c.json({ error: "Another workspace watches this account. Connect Facebook to prove you have access and claim it." }, 409);
      const check = await fetch(`https://graph.facebook.com/${config.graph.version}/${id}?fields=id&access_token=${encodeURIComponent(decrypt(conn.tokenEnc))}`);
      if (!check.ok) return c.json({ error: "Your Facebook account doesn't have access to this ad account" }, 403);
    }
    const [brand] = await db.select().from(schema.brands).where(and(eq(schema.brands.workspaceId, ws.workspaceId), eq(schema.brands.name, body.data.brandName)));
    const brandId = brand?.id ?? randomUUID();
    if (!brand) await db.insert(schema.brands).values({ id: brandId, workspaceId: ws.workspaceId, name: body.data.brandName, policy: {} });
    if (exists) {
      await db.update(schema.adAccounts).set({ brandId, name: body.data.name, connectionId: conn?.id ?? null, watching: true }).where(eq(schema.adAccounts.metaAccountId, id));
      await rt.audit(user.id, "account.claimed", { metaAccountId: id });
    } else {
      await db.insert(schema.adAccounts).values({ id: randomUUID(), brandId, metaAccountId: id, name: body.data.name, connectionId: conn?.id });
      await rt.audit(user.id, "account.connected", { metaAccountId: id });
    }
    // First check right away, so the account isn't empty until the worker's next tick.
    void rt.runCycle(id).catch((err) => console.error("[keel] first check failed", err));
    return c.json({ brandId, claimed: Boolean(exists) }, exists ? 200 : 201);
  });

  // ── Workspace ──────────────────────────────────────────────────────────────
  r.get("/workspace/members", async (c) => {
    const user = c.get("user");
    const wsIds = (await db.select({ ws: schema.memberships.workspaceId }).from(schema.memberships).where(eq(schema.memberships.userId, user.id))).map((r) => r.ws);
    if (!wsIds.length) return c.json([]);
    const rows = await db.select({ workspaceId: schema.memberships.workspaceId, workspace: schema.workspaces.name, isDemo: schema.workspaces.isDemo, userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
      .from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
      .where(and(inArray(schema.memberships.workspaceId, wsIds), notInArray(schema.users.id, ["user_demo_viewer"])));
    return c.json(rows);
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
    if (/^https:\/\//.test(ref)) return c.redirect(ref);
    if (!ref.startsWith("file://")) return c.json({ error: "bad ref" }, 400);
    const path = resolve(ref.slice(7));
    if (!mediaRoots().some((root) => path.startsWith(root + "/"))) return c.json({ error: "forbidden" }, 403);
    const body = await readFile(path).catch(() => null);
    if (!body) return c.json({ error: "not found" }, 404);
    return c.body(body, 200, { "Content-Type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "private, max-age=86400, immutable" });
  });

  return r;
}
