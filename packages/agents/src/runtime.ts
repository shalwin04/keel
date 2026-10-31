import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { RulebookSchema, type AdSnapshot, type BrandPolicy, type Finding, type Proposal, type TraceEvent } from "@keel/core";
import { GENESIS, chain, createDb, decrypt, publishEvent, schema } from "@keel/db";
import {
  AdsGraphClient, CompositeVariantSource, FixtureVariantSource, MetaPreviewSource, MetaSamSegmenter, WholeImageSegmenter,
  captureRemote, imageHashOf, originalImageOf, readMedia, type ImageInput, type VariantSource,
} from "@keel/meta";
import { executeAction, verifyAction } from "./actions.ts";
import type { KeelDeps } from "./deps.ts";
import { driftedFeature, findingKey } from "./drift.ts";
import { buildCycleGraph } from "./graph.ts";
import { makeInspect, makeInvestigate, makeScreen, type OnModelCall } from "./judges.ts";
import { sendPush, type PushTarget } from "./push.ts";
import { cycleContext, traceEvent } from "./trace.ts";

/** file:// refs become data URLs (models can't reach our disk); http(s) refs pass through. */
export async function loadImage(ref: string): Promise<ImageInput> {
  if (!ref) throw new Error("missing image");
  if (ref.startsWith("file://")) {
    const m = await readMedia(ref);
    return { dataUrl: `data:${m.mime};base64,${m.bytes.toString("base64")}` };
  }
  return { url: ref };
}

function variantSources(ads: AdsGraphClient): VariantSource {
  const wanted = (process.env.VARIANT_SOURCE ?? "meta,fixtures").split(",").map((s) => s.trim());
  const list: VariantSource[] = [];
  if (wanted.includes("meta")) list.push(new MetaPreviewSource(ads));
  if (wanted.includes("fixtures")) list.push(new FixtureVariantSource());
  return new CompositeVariantSource(list);
}

/** Wires the cycle graph to Meta APIs, Postgres and web push. Shared by the worker and the API. */
export async function createRuntime() {
  const { db, pool } = createDb();
  const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
  await checkpointer.setup();

  // ── per-account Meta access ────────────────────────────────────────────────
  async function adsFor(metaAccountId: string): Promise<AdsGraphClient> {
    const [row] = await db
      .select({ tokenEnc: schema.metaConnections.tokenEnc })
      .from(schema.adAccounts)
      .leftJoin(schema.metaConnections, eq(schema.adAccounts.connectionId, schema.metaConnections.id))
      .where(eq(schema.adAccounts.metaAccountId, metaAccountId));
    const token = row?.tokenEnc ? decrypt(row.tokenEnc) : process.env.META_SYSTEM_USER_TOKEN;
    if (!token) throw new Error(`No Meta token for ${metaAccountId}: connect it with Facebook or set META_SYSTEM_USER_TOKEN`);
    return new AdsGraphClient(token);
  }
  const currentAccount = () => {
    const id = cycleContext.getStore()?.accountId;
    if (!id) throw new Error("No account in cycle context");
    return id;
  };

  const segmenter = process.env.SAM_DISABLED === "1" ? new WholeImageSegmenter() : new MetaSamSegmenter();

  // ── trace + audit ──────────────────────────────────────────────────────────
  const emit = async (e: TraceEvent) => {
    await db.insert(schema.traceEvents).values({ cycleId: e.cycleId, kind: e.kind, node: e.node, at: new Date(e.at), data: e.data });
    await publishEvent(pool, e);
  };
  const onModelCall: OnModelCall = (info) => {
    const e = traceEvent("model_call", { ...info });
    if (e) void emit(e).catch(() => {});
  };

  // Serialised so concurrent cycles can't fork the hash chain.
  let auditQueue: Promise<unknown> = Promise.resolve();
  const audit: KeelDeps["audit"] = (actor, event, payload) => {
    const run = auditQueue.then(async () => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(4242)`);
        const [last] = await tx.select({ hash: schema.auditLog.hash }).from(schema.auditLog).orderBy(desc(schema.auditLog.seq)).limit(1);
        const e = chain(last?.hash ?? GENESIS, actor, event, payload);
        await tx.insert(schema.auditLog).values({ actor, event, payload: payload as object, prevHash: e.prevHash, hash: e.hash });
      });
    });
    auditQueue = run.catch(() => {});
    return run;
  };

  // ── who to notify ──────────────────────────────────────────────────────────
  async function pushTargetsFor(metaAccountId: string): Promise<PushTarget[]> {
    const rows = await db
      .select({ endpoint: schema.pushSubscriptions.endpoint, keys: schema.pushSubscriptions.keys })
      .from(schema.adAccounts)
      .innerJoin(schema.brands, eq(schema.adAccounts.brandId, schema.brands.id))
      .innerJoin(schema.memberships, eq(schema.memberships.workspaceId, schema.brands.workspaceId))
      .innerJoin(schema.pushSubscriptions, eq(schema.pushSubscriptions.userId, schema.memberships.userId))
      .where(and(eq(schema.adAccounts.metaAccountId, metaAccountId), inArray(schema.memberships.role, ["owner", "reviewer"])));
    return rows.map((r) => ({ endpoint: r.endpoint, keys: r.keys as PushTarget["keys"] }));
  }

  async function lockBaseline(adId: string, creativeId: string, featuresSpec: Record<string, string>, lockedBy: string) {
    await db.insert(schema.creativeBaselines).values({ creativeId, adId, featuresSpec, lockedBy })
      .onConflictDoUpdate({ target: schema.creativeBaselines.creativeId, set: { featuresSpec, lockedBy, lockedAt: new Date() } });
  }

  const deps: KeelDeps = {
    async loadBrand(accountId) {
      const [row] = await db.select({ brandId: schema.brands.id, policy: schema.brands.policy })
        .from(schema.adAccounts).innerJoin(schema.brands, eq(schema.adAccounts.brandId, schema.brands.id))
        .where(eq(schema.adAccounts.metaAccountId, accountId));
      if (!row) return undefined;
      const [rb] = await db.select().from(schema.rulebooks).where(eq(schema.rulebooks.brandId, row.brandId)).orderBy(desc(schema.rulebooks.version)).limit(1);
      const parsed = rb ? RulebookSchema.safeParse(rb.rules) : undefined;
      return { rulebook: parsed?.success ? parsed.data : undefined, policy: (row.policy ?? {}) as Partial<BrandPolicy> };
    },

    async snapshotAccount(accountId) {
      const ads = await adsFor(accountId);
      const variants = variantSources(ads);
      const { data } = await ads.listActiveAds(accountId);
      const out: AdSnapshot[] = [];
      try {
        for (const ad of data) {
          const creative = await ads.getCreative(ad.creative.id);
          // Prefer the full-size library image; fall back to whatever URL the creative carries.
          const hash = imageHashOf(creative);
          const original = (hash && !creative.image_url ? await ads.imageUrl(accountId, hash).catch(() => undefined) : undefined) ?? originalImageOf(creative);
          out.push({
            adId: ad.id, adName: ad.name, status: ad.effective_status ?? ad.status, creativeId: ad.creative.id,
            originalImageRef: original ? await captureRemote(original) : undefined,
            primaryText: creative.body ?? ((creative.object_story_spec?.link_data as { message?: string } | undefined)?.message),
            featuresSpec: Object.fromEntries(Object.entries(creative.degrees_of_freedom_spec?.creative_features_spec ?? {}).map(([k, v]) => [k, v.enroll_status ?? "UNKNOWN"])),
            variants: await variants.listVariants(ad.id),
          });
        }
      } finally {
        await variants.close?.();
      }
      return out;
    },

    async recordSnapshots(cycleId, accountId, snaps) {
      await db.insert(schema.cycles).values({ id: cycleId, accountId, status: "running" }).onConflictDoNothing();
      if (!snaps.length) return;
      await db.insert(schema.snapshots).values(snaps.map((s) => ({
        id: randomUUID(), cycleId, accountId, adId: s.adId, adName: s.adName, status: s.status, creativeId: s.creativeId,
        originalRef: s.originalImageRef, featuresSpec: s.featuresSpec, variants: s.variants,
      })));
      // First sight of an AD locks its current settings as the baseline. A later edit in Ads Manager
      // swaps in a new creative id; that must be compared to the ad's baseline, not re-locked.
      const known = new Set((await db.select({ adId: schema.creativeBaselines.adId }).from(schema.creativeBaselines)
        .where(inArray(schema.creativeBaselines.adId, snaps.map((s) => s.adId)))).map((r) => r.adId));
      for (const s of snaps.filter((x) => !known.has(x.adId))) await lockBaseline(s.adId, s.creativeId, s.featuresSpec, "keel:first-seen");
    },

    async getBaseline(creativeId, adId) {
      const [row] = await db.select().from(schema.creativeBaselines)
        .where(or(eq(schema.creativeBaselines.creativeId, creativeId), eq(schema.creativeBaselines.adId, adId)))
        .orderBy(desc(schema.creativeBaselines.lockedAt)).limit(1);
      return row?.featuresSpec as Record<string, string> | undefined;
    },

    screen: makeScreen(loadImage, onModelCall),
    inspect: makeInspect(loadImage, segmenter, onModelCall),
    investigate: process.env.INVESTIGATOR_DISABLED === "1" ? undefined : makeInvestigate(loadImage, onModelCall),

    async filterFindings(accountId, findings) {
      if (!findings.length) return findings;
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      const prior = await db.select({ adId: schema.findings.adId, code: schema.findings.code, variantId: schema.findings.variantId, evidence: schema.findings.evidence, status: schema.findings.status, createdAt: schema.findings.createdAt })
        .from(schema.findings)
        .where(and(eq(schema.findings.accountId, accountId), inArray(schema.findings.adId, findings.map((f) => f.adId)),
          or(eq(schema.findings.status, "dismissed"), and(eq(schema.findings.status, "logged"), gt(schema.findings.createdAt, weekAgo)))));
      const skip = new Set(prior.map((p) => findingKey({ adId: p.adId, code: p.code as Finding["code"], variantId: p.variantId ?? undefined, evidence: p.evidence as string[] })));
      return findings.filter((f) => !skip.has(findingKey(f)));
    },

    async recordDecisions(cycleId, accountId, findings: Finding[], proposals: Proposal[]) {
      const logOnly = new Set(proposals.filter((p) => p.action === "LOG").flatMap((p) => p.findingIds));
      if (findings.length) {
        await db.insert(schema.findings).values(findings.map((f) => ({
          id: f.id, cycleId, accountId, adId: f.adId, variantId: f.variantId, code: f.code, severity: f.severity,
          confidence: f.confidence, summary: f.summary, evidence: f.evidence, regions: f.regions, detectedBy: f.detectedBy,
          originalRef: f.originalRef, variantRef: f.variantRef, status: logOnly.has(f.id) ? "logged" : "open",
        }))).onConflictDoNothing();
      }
      if (proposals.length) {
        await db.insert(schema.proposals).values(proposals.map((p) => ({
          id: p.id, cycleId, accountId, adId: p.adId, findingIds: p.findingIds, action: p.action, reason: p.reason,
          requiresApproval: p.requiresApproval,
          status: p.action === "LOG" ? "logged" : p.requiresApproval ? "pending" : "approved",
          expiresAt: new Date(p.expiresAt),
        }))).onConflictDoNothing();
      }
    },

    async notify(p: Proposal, findings: Finding[], cycleId: string) {
      await db.update(schema.cycles).set({ status: "awaiting_approval" }).where(eq(schema.cycles.id, cycleId));
      const top = findings[0];
      try {
        const gone = await sendPush(await pushTargetsFor(currentAccount()), {
          title: `Keel caught: ${top?.code.replaceAll("_", " ").toLowerCase() ?? p.action}`,
          body: top?.summary ?? p.reason,
          url: `/review/${p.id}`,
          tag: p.id,
        });
        if (gone.length) await db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.endpoint, gone));
      } catch (err) {
        console.warn("[keel] push failed", err);
      }
    },

    async execute(p, approval, ctx) {
      const accountId = currentAccount();
      return executeAction({ ads: await adsFor(accountId), accountId, load: loadImage }, p, approval, ctx);
    },

    async verify(p, executed) {
      const accountId = currentAccount();
      const result = await verifyAction({ ads: await adsFor(accountId), accountId }, p, executed);
      // A verified swap makes the new creative the ad's approved baseline.
      const creativeId = executed.data?.creativeId as string | undefined;
      if (result.ok && creativeId) {
        await lockBaseline(p.adId, creativeId, executed.data?.features as Record<string, string>, (executed.data?.by as string) ?? "keel:action");
      }
      return result;
    },

    async recordFeedback({ findings, proposals, approvals, outcomes, snapshots }) {
      for (const p of proposals.filter((x) => x.requiresApproval)) {
        const a = approvals.find((x) => x.proposalId === p.id);
        const o = outcomes.find((x) => x.proposalId === p.id);
        const ids = p.findingIds;
        if (!a) continue;
        if (a.decision === "reject") {
          await db.update(schema.proposals).set({ status: "rejected" }).where(eq(schema.proposals.id, p.id));
          await db.update(schema.findings).set({ status: "dismissed" }).where(inArray(schema.findings.id, ids));
          // Learning: a rejected drift means the person is fine with that setting, so it becomes the baseline.
          const snap = snapshots.find((s) => s.adId === p.adId);
          const drifted = findings.filter((f) => ids.includes(f.id) && f.code === "SETTING_DRIFT").map(driftedFeature).filter(Boolean);
          if (snap && drifted.length) await lockBaseline(snap.adId, snap.creativeId, snap.featuresSpec, a.decidedBy);
          continue;
        }
        const ok = o?.executed?.ok && o.verified?.ok !== false;
        await db.update(schema.proposals).set({ status: ok ? "executed" : "failed", outcome: { executed: o?.executed, verified: o?.verified } }).where(eq(schema.proposals.id, p.id));
        if (ok) await db.update(schema.findings).set({ status: "resolved" }).where(inArray(schema.findings.id, ids));
      }
      const cycleId = cycleContext.getStore()?.cycleId;
      if (cycleId) await db.update(schema.cycles).set({ status: "completed", endedAt: new Date() }).where(eq(schema.cycles.id, cycleId));
    },

    audit,
    emit,
  };

  const graph = buildCycleGraph(deps, undefined, checkpointer);

  return {
    graph,
    deps,
    db,
    pool,
    audit,
    adsFor,
    /** Runs a cycle to completion or to its approval pause. Thread id = cycle id. */
    async runCycle(accountId: string, cycleId: string = randomUUID()) {
      await db.insert(schema.cycles).values({ id: cycleId, accountId, status: "running" }).onConflictDoNothing();
      try {
        await graph.invoke({ cycleId, accountId }, { configurable: { thread_id: cycleId } });
      } catch (err) {
        await db.update(schema.cycles).set({ status: "failed", endedAt: new Date(), error: String((err as Error).message ?? err).slice(0, 500) }).where(eq(schema.cycles.id, cycleId));
        await emit({ cycleId, kind: "cycle_end", at: new Date().toISOString(), data: { failed: true, error: String((err as Error).message ?? err) } }).catch(() => {});
        throw err;
      }
      return cycleId;
    },
    async threadForProposal(proposalId: string) {
      const [row] = await db.select({ cycleId: schema.proposals.cycleId }).from(schema.proposals).where(eq(schema.proposals.id, proposalId));
      return row?.cycleId;
    },
    async close() {
      await pool.end();
      await checkpointer.end();
    },
  };
}
