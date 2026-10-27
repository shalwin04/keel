import pg from "pg";
import type { TraceEvent } from "@keel/core";

export const EVENTS_CHANNEL = "keel_events";

/** Cross-process fan-out (worker → API → browsers) via Postgres NOTIFY. Payload kept under the 8 KB limit. */
export async function publishEvent(pool: pg.Pool, e: TraceEvent) {
  let payload = JSON.stringify(e);
  if (payload.length > 7500) payload = JSON.stringify({ ...e, data: { truncated: true } });
  await pool.query("SELECT pg_notify($1, $2)", [EVENTS_CHANNEL, payload]);
}

export async function subscribeEvents(url: string, onEvent: (e: TraceEvent) => void) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  client.on("notification", (msg) => {
    if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
    try { onEvent(JSON.parse(msg.payload) as TraceEvent); } catch { /* ignore malformed */ }
  });
  await client.query(`LISTEN ${EVENTS_CHANNEL}`);
  return () => client.end();
}
