import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { desc, eq } from "drizzle-orm";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { AdSnapshot, Approval, Finding, Proposal } from "@keel/core";
import { GENESIS, chain, createDb, schema } from "@keel/db";
import {
  AdsGraphClient, FixtureVariantSource, MetaPreviewSource, MetaSamSegmenter, WholeImageSegmenter,
  encodeButtonId, sendFindingCard, type ImageInput, type VariantSource,
} from "@keel/meta";
import type { KeelDeps } from "./deps.ts";
import { buildCycleGraph } from "./graph.ts";
import { makeInspect, makeScreen } from "./judges.ts";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export async function loadImage(ref: string): Promise<ImageInput> {
  if (ref.startsWith("file://")) {
    const path = ref.slice(7);
    const b64 = (await readFile(path)).toString("base64");
    return { dataUrl: `data:${MIME[extname(path).toLowerCase()] ?? "image/png"};base64,${b64}` };
  }
  return { url: ref };
}

/** Wires the cycle graph to real Meta APIs, Postgres and WhatsApp. Shared by the worker and the API. */
export async function createRuntime() {
  const { db, pool } = createDb();
  const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
  await checkpointer.setup();

  const ads = new AdsGraphClient();
  const variants: VariantSource =
    process.env.VARIANT_SOURCE === "meta" ? new MetaPreviewSource(ads) : new FixtureVariantSource();
  const segmenter = process.env.SAM_DISABLED ? new WholeImageSegmenter() : new MetaSamSegmenter();

  const audit: KeelDeps["audit"] = async (actor, event, payload) => {
    const [last] = await db.select({ hash: schema.auditLog.hash }).from(schema.auditLog).orderBy(desc(schema.auditLog.seq)).limit(1);
    const e = chain(last?.hash ?? GENESIS, actor, event, payload);
    await db.insert(schema.auditLog).values({ actor, event, payload: payload as object, prevHash: e.prevHash, hash: e.hash });
  };

  const deps: KeelDeps = {
    async snapshotAccount(accountId) {
      const { data } = await ads.listActiveAds(accountId);
      const out: AdSnapshot[] = [];
      for (const ad of data) {
        const creative = await ads.getCreative(ad.creative.id);
        out.push({
          adId: ad.id,
          adName: ad.name,
          status: ad.status,
          creativeId: ad.creative.id,
          originalImageRef: creative.image_url,
          primaryText: creative.body,
          featuresSpec: await ads.getFeaturesSpec(ad.creative.id),
          variants: await variants.listVariants(ad.id),
        });
      }
      return out;
    },

    async getBaseline(creativeId) {
      const [row] = await db.select().from(schema.creativeBaselines).where(eq(schema.creativeBaselines.creativeId, creativeId));
      return row?.featuresSpec as Record<string, string> | undefined;
    },

    screen: makeScreen(loadImage),
    inspect: makeInspect(loadImage, segmenter),

    async notify(p: Proposal, findings: Finding[], cycleId: string) {
      await db.insert(schema.proposals).values({
        id: p.id, adId: p.adId, findingIds: p.findingIds, action: p.action, reason: p.reason,
        requiresApproval: p.requiresApproval, threadId: cycleId, expiresAt: new Date(p.expiresAt),
      });
      const to = process.env.OWNER_WHATSAPP;
      if (!to) return;
      const top = findings[0];
      // TODO(day 7): compose a side-by-side card image (original | served, masks drawn) and host it.
      const card = `${process.env.PUBLIC_BASE_URL}/cards/${p.id}.png`;
      await sendFindingCard(to, card, `Keel caught: ${top?.summary ?? p.reason}\nAd ${p.adId}. Proposed: ${p.action}.`, [
        { id: encodeButtonId(p.id, "approve"), title: p.action === "PAUSE_AD" ? "Pause ad" : "Revert" },
        { id: encodeButtonId(p.id, "replace"), title: "On-brand replacement" },
        { id: encodeButtonId(p.id, "reject"), title: "Leave it" },
      ]);
    },

    async execute(p: Proposal, _approval?: Approval) {
      switch (p.action) {
        case "PAUSE_AD": {
          await ads.pauseAd(p.adId);
          return { ok: true, detail: "paused" }; // TODO(day 6): re-read status to verify
        }
        case "RELOCK_SETTING":
        case "REVERT_CREATIVE":
        case "REPLACE_CREATIVE":
          return { ok: false, detail: `${p.action} not implemented yet` };
        default:
          return { ok: true, detail: "logged" };
      }
    },

    audit,
  };

  const graph = buildCycleGraph(deps, undefined, checkpointer);

  return {
    graph,
    db,
    audit,
    async runCycle(accountId: string) {
      const cycleId = randomUUID();
      await graph.invoke({ cycleId, accountId }, { configurable: { thread_id: cycleId } });
      return cycleId;
    },
    async threadForProposal(proposalId: string) {
      const [row] = await db.select({ threadId: schema.proposals.threadId }).from(schema.proposals).where(eq(schema.proposals.id, proposalId));
      return row?.threadId;
    },
    async close() {
      await pool.end();
      await checkpointer.end();
    },
  };
}
