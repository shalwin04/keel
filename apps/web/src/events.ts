import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { TraceRow } from "./api.ts";

export type Live = "connecting" | "live" | "offline";

/** One EventSource for the app; new events refresh the queries they affect. */
export function useLiveEvents(enabled: boolean): Live {
  const qc = useQueryClient();
  const [state, setState] = useState<Live>("connecting");

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/events", { withCredentials: true });
    es.onopen = () => setState("live");
    es.onerror = () => setState("offline");
    const onTrace = (ev: MessageEvent<string>) => {
      const e = JSON.parse(ev.data) as Omit<TraceRow, "seq">;
      qc.setQueryData<{ events: TraceRow[] } | undefined>(["trace", e.cycleId], (old) =>
        old ? { ...old, events: [...old.events, { ...e, seq: Date.now() }] } : old);
      if (e.kind === "proposal" || e.kind === "decision" || e.kind === "finding") {
        void qc.invalidateQueries({ queryKey: ["queue"] });
        void qc.invalidateQueries({ queryKey: ["accounts"] });
      }
      if (e.kind === "cycle_start" || e.kind === "cycle_end") void qc.invalidateQueries({ queryKey: ["cycles"] });
    };
    for (const kind of ["cycle_start", "node_start", "node_end", "model_call", "finding", "proposal", "decision", "action", "cycle_end", "error"]) {
      es.addEventListener(kind, onTrace);
    }
    return () => es.close();
  }, [enabled, qc]);

  return state;
}
