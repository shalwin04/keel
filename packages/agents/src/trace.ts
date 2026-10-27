import { AsyncLocalStorage } from "node:async_hooks";
import type { TraceEvent, TraceKind } from "@keel/core";

/** Which cycle and node the current async work belongs to, so deep calls (model clients) can report into the trace. */
export const cycleContext = new AsyncLocalStorage<{ cycleId: string; accountId?: string; node?: string }>();

export type Emit = (e: TraceEvent) => void | Promise<void>;

export function traceEvent(kind: TraceKind, data: Record<string, unknown> = {}, node?: string, cycleId?: string): TraceEvent | undefined {
  const ctx = cycleContext.getStore();
  const id = cycleId ?? ctx?.cycleId;
  if (!id) return undefined;
  return { cycleId: id, kind, node: node ?? ctx?.node, at: new Date().toISOString(), data };
}
