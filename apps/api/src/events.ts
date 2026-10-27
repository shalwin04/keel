import { eq } from "drizzle-orm";
import type { TraceEvent } from "@keel/core";
import { schema, subscribeEvents, type Db } from "@keel/db";

type Listener = { accounts: Set<string>; send: (e: TraceEvent) => void };

/** One Postgres LISTEN per API process, fanned out to every open SSE stream the user may see. */
export async function createEventHub(db: Db, url: string) {
  const listeners = new Set<Listener>();
  const cycleAccount = new Map<string, string>();

  async function accountOf(cycleId: string) {
    const hit = cycleAccount.get(cycleId);
    if (hit) return hit;
    const [row] = await db.select({ accountId: schema.cycles.accountId }).from(schema.cycles).where(eq(schema.cycles.id, cycleId));
    if (row) cycleAccount.set(cycleId, row.accountId);
    return row?.accountId;
  }

  const stop = await subscribeEvents(url, (e) => {
    void accountOf(e.cycleId).then((accountId) => {
      if (!accountId) return;
      for (const l of listeners) if (l.accounts.has(accountId)) l.send(e);
    });
  });

  return {
    add(l: Listener) { listeners.add(l); return () => listeners.delete(l); },
    stop,
  };
}
