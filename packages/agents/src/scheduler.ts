import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { schema } from "@keel/db";
import type { createRuntime } from "./runtime.ts";

type Runtime = Awaited<ReturnType<typeof createRuntime>>;

/** A cycle that has been "running" this long is assumed dead (process restarted mid-cycle). */
const STALE_RUN_MIN = 30;

/**
 * Housekeeping before each tick: approvals past their deadline expire (and their cycles close),
 * and cycles orphaned by a crash are marked failed so the account isn't blocked forever.
 */
export async function sweep(rt: Runtime) {
  const { db } = rt;
  const now = new Date();
  const expired = await db.update(schema.proposals).set({ status: "expired" })
    .where(and(eq(schema.proposals.status, "pending"), lt(schema.proposals.expiresAt, now)))
    .returning({ cycleId: schema.proposals.cycleId, id: schema.proposals.id });
  for (const cycleId of new Set(expired.map((e) => e.cycleId))) {
    const still = await db.select({ id: schema.proposals.id }).from(schema.proposals)
      .where(and(eq(schema.proposals.cycleId, cycleId), inArray(schema.proposals.status, ["pending", "deciding"])));
    if (!still.length) await db.update(schema.cycles).set({ status: "expired", endedAt: now }).where(eq(schema.cycles.id, cycleId));
  }
  for (const e of expired) await rt.audit("keel", "proposal.expired", { proposalId: e.id });
  await db.update(schema.cycles).set({ status: "failed", endedAt: now, error: "worker stopped mid-cycle" })
    .where(and(eq(schema.cycles.status, "running"), lt(schema.cycles.startedAt, new Date(now.getTime() - STALE_RUN_MIN * 60_000))));
  return { expired: expired.length };
}

/** Accounts whose interval has passed and that aren't mid-cycle or waiting on a person. */
export async function dueAccounts(rt: Runtime, now = new Date()) {
  const { db } = rt;
  const accounts = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.watching, true));
  const due: string[] = [];
  for (const a of accounts) {
    const [last] = await db.select().from(schema.cycles).where(eq(schema.cycles.accountId, a.metaAccountId)).orderBy(desc(schema.cycles.startedAt)).limit(1);
    if (last && (last.status === "running" || last.status === "awaiting_approval")) continue;
    if (last && now.getTime() - last.startedAt.getTime() < a.pollIntervalMin * 60_000) continue;
    due.push(a.metaAccountId);
  }
  return due;
}
