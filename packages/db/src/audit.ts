import { createHash } from "node:crypto";

export interface AuditEntry {
  actor: string;
  event: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);

/** Stable JSON: sorted keys, so the same event always hashes the same. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function chain(prevHash: string, actor: string, event: string, payload: unknown): AuditEntry {
  const hash = createHash("sha256").update(prevHash).update(canonical({ actor, event, payload })).digest("hex");
  return { actor, event, payload, prevHash, hash };
}

/** Returns the index of the first broken link, or -1 if the chain is intact. */
export function verifyChain(entries: AuditEntry[]): number {
  let prev = GENESIS;
  for (const [i, e] of entries.entries()) {
    if (e.prevHash !== prev || chain(prev, e.actor, e.event, e.payload).hash !== e.hash) return i;
    prev = e.hash;
  }
  return -1;
}
