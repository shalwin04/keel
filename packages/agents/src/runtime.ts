import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { AdSnapshot, Finding, Proposal, TraceEvent } from "@keel/core";
import { GENESIS, chain, createDb, decrypt, publishEvent, schema } from "@keel/db";
import {
  AdsGraphClient, FixtureVariantSource, MetaPreviewSource, MetaSamSegmenter, WholeImageSegmenter,
  type ImageInput, type VariantSource,
} from "@keel/meta";
import type { KeelDeps } from "./deps.ts";
import { buildCycleGraph } from "./graph.ts";
import { makeInspect, makeScreen, type OnModelCall } from "./judges.ts";
import { sendPush, type PushTarget } from "./push.ts";
import { cycleContext, traceEvent } from "./trace.ts";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };

export async function loadImage(ref: string): Promise<ImageInput> {
  if (ref.startsWith("file://")) {
    const path = ref.slice(7);
    const b64 = (await readFile(path)).toString("base64");
    return { dataUrl: `data:${MIME[extname(path).toLowerCase()] ?? "image/png"};base64,${b64}` };
  }
  return { url: ref };
}

/** Wires the cycle graph to Meta APIs, Postgres and web push. Shared by the worker and the API. */
export async function createRuntime() {
  const { db, pool } = createDb();
  const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
  await checkpointer.setup();

  // ── per-account Meta access ────────────────────────────────────────────────
  const adsClients = new Map<string, AdsGraphClient>();
  async function adsFor(metaAccountId: string): Promise<AdsGraphClient> {
    const cached = adsClients.get(metaAccountId);
    if (cached) return cached;
    const [row] = await db
      .select({ tokenEnc: schema.metaConnections.tokenEnc })
      .from(schema.adAccounts)
      .leftJoin(schema.metaConnections, eq(schema.adAccounts.connectionId, schema.metaConnections.id))
      .where(eq(schema.adAccounts.metaAccountId, metaAccountId));
    const token = row?.tokenEnc ? decrypt(row.tokenEnc) : process.env.META_SYSTEM_USER_TOKEN;
    if (!token) throw new Error(`No Meta token for ${metaAccountId}`);
    const client = new AdsGraphClient(token);
    adsClients.set(metaAccountId, client);
    return client;
  }
  const currentAccount = () => {
    const id = cycleContext.getStore()?.accountId;
    if (!id) throw new Error("No account in cycle context");
    return id;
  };

  const segmenter = process.env.SAM_DISABLED ? new WholeImageSegmenter() : new MetaSamSegmenter();

  // ── trace + audit ──────────────────────────────────────────────────────────
  const emit = async (e: TraceEvent) => {
    await db.insert(schema.traceEvents).values({ cycleId: e.cycleId, kind: e.kind, node: e.node, at: new Date(e.at), data: e.data });
    await publishEvent(pool, e);
  };
  const onModelCall: OnModelCall = (info) => {
    const e = traceEvent("model_call", { ...info });
    if (e) void emit(e).catch(() => {});
  };

  const audit: KeelDeps["audit"] = async (actor, event, payload) => {
    const [last] = await db.select({ hash: schema.auditLog.hash }).from(schema.auditLog).orderBy(desc(schema.auditLog.seq)).limit(1);
    const e = chain(last?.hash ?? GENESIS, actor, event, payload);
    await db.insert(schema.auditLog).values({ actor, event, payload: payload as object, prevHash: e.prevHash, hash: e.hash });
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

  const deps: KeelDeps = {
    async snapshotAccount(accountId) {
      const ads = await adsFor(accountId);
      const variants: VariantSource = process.env.VARIANT_SOURCE === "meta" ? new MetaPreviewSource(ads) : new FixtureVariantSource();
      const { data } = await ads.listActiveAds(accountId);
      const out: AdSnapshot[] = [];
      for (const ad of data) {
        const creative = await ads.getCreative(ad.creative.id);
        out.push({
          adId: ad.id, adName: ad.name, status: ad.status, creativeId: ad.creative.id,
          originalImageRef: creative.image_url, primaryText: creative.body,
          featuresSpec: await ads.getFeaturesSpec(ad.creative.id),
          variants: await variants.listVariants(ad.id),
        });
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
      // First sight of a creative locks its current settings as the baseline.
      await db.insert(schema.creativeBaselines).values(snaps.map((s) => ({
        creativeId: s.creativeId, adId: s.adId, featuresSpec: s.featuresSpec, lockedBy: "keel:first-seen",
      }))).onConflictDoNothing();
    },

    async getBaseline(creativeId) {
      const [row] = await db.select().from(schema.creativeBaselines).where(eq(schema.creativeBaselines.creativeId, creativeId));
      return row?.featuresSpec as Record<string, string> | undefined;
    },

    screen: makeScreen(loadImage, onModelCall),
    inspect: makeInspect(loadImage, segmenter, onModelCall),

    async recordDecisions(cycleId, accountId, findings: Finding[], proposals: Proposal[]) {
      if (findings.length) {
        await db.insert(schema.findings).values(findings.map((f) => ({
          id: f.id, cycleId, accountId, adId: f.adId, variantId: f.variantId, code: f.code, severity: f.severity,
          confidence: f.confidence, summary: f.summary, evidence: f.evidence, regions: f.regions, detectedBy: f.detectedBy,
          originalRef: f.originalRef, variantRef: f.variantRef,
        }))).onConflictDoNothing();
      }
      if (proposals.length) {
        await db.insert(schema.proposals).values(proposals.map((p) => ({
          id: p.id, cycleId, accountId, adId: p.adId, findingIds: p.findingIds, action: p.action, reason: p.reason,
          requiresApproval: p.requiresApproval, status: p.requiresApproval ? "pending" : "approved", expiresAt: new Date(p.expiresAt),
        }))).onConflictDoNothing();
      }
    },

    async notify(p: Proposal, findings: Finding[], cycleId: string) {
      await db.update(schema.cycles).set({ status: "awaiting_approval" }).where(eq(schema.cycles.id, cycleId));
      const top = findings[0];
      const gone = await sendPush(await pushTargetsFor(currentAccount()), {
        title: `Keel caught: ${top?.code.replaceAll("_", " ").toLowerCase() ?? p.action}`,
        body: top?.summary ?? p.reason,
        url: `/review/${p.id}`,
        tag: p.id,
      });
      if (gone.length) await db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.endpoint, gone));
    },

    async execute(p) {
      const ads = await adsFor(currentAccount());
      switch (p.action) {
        case "PAUSE_AD":
          await ads.pauseAd(p.adId);
          return { ok: true, detail: "pause requested" };
        case "RELOCK_SETTING":
        case "REVERT_CREATIVE":
        case "REPLACE_CREATIVE":
          return { ok: false, detail: `${p.action} not implemented yet` }; // M5
        default:
          return { ok: true, detail: "logged" };
      }
    },

    async verify(p) {
      if (p.action !== "PAUSE_AD") return { ok: true, detail: "nothing to verify" };
      const ad = await (await adsFor(currentAccount())).getAd(p.adId);
      return ad.status === "PAUSED" ? { ok: true, detail: "ad is paused" } : { ok: false, detail: `ad status is ${ad.status}` };
    },

    async recordFeedback(_findings, approvals) {
      for (const a of approvals) {
        const status = a.decision === "approve" ? "approved" : a.decision === "replace" ? "replaced" : "rejected";
        await db.update(schema.proposals).set({ status }).where(eq(schema.proposals.id, a.proposalId));
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
    /** Runs a cycle to completion or to its approval pause. Thread id = cycle id. */
    async runCycle(accountId: string, cycleId: string = randomUUID()) {
      try {
        await graph.invoke({ cycleId, accountId }, { configurable: { thread_id: cycleId } });
      } catch (err) {
        await db.update(schema.cycles).set({ status: "failed", endedAt: new Date() }).where(eq(schema.cycles.id, cycleId));
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
