import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Command } from "@langchain/langgraph";
import { desc } from "drizzle-orm";
import type { Approval } from "@keel/core";
import { createRuntime } from "@keel/agents";
import { schema } from "@keel/db";
import { decodeButtonId, verifyWebhookSignature } from "@keel/meta";

const rt = await createRuntime();
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "keel-api" }));

app.get("/api/findings", async (c) =>
  c.json(await rt.db.select().from(schema.findings).orderBy(desc(schema.findings.createdAt)).limit(100)));

app.get("/api/audit", async (c) =>
  c.json(await rt.db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.seq)).limit(200)));

/** WhatsApp webhook verification handshake. */
app.get("/webhooks/whatsapp", (c) => {
  const q = c.req.query();
  return q["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN ? c.text(q["hub.challenge"] ?? "") : c.text("forbidden", 403);
});

/** Button taps resume the paused cycle with the owner's decision. */
app.post("/webhooks/whatsapp", async (c) => {
  const raw = await c.req.text();
  if (!verifyWebhookSignature(raw, c.req.header("x-hub-signature-256"))) return c.text("bad signature", 401);
  const body = JSON.parse(raw);
  const messages: any[] = body?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];

  for (const m of messages) {
    const buttonId: string | undefined = m?.interactive?.button_reply?.id;
    if (!buttonId) continue; // TODO(day 7): voice notes → Muse Voice Transcribe → intent
    const decoded = decodeButtonId(buttonId);
    if (!decoded) continue;
    const threadId = await rt.threadForProposal(decoded.proposalId);
    if (!threadId) continue;
    const approval: Approval = {
      proposalId: decoded.proposalId,
      decision: decoded.decision as Approval["decision"],
      decidedBy: m.from,
      channel: "whatsapp_button",
    };
    // Resume in the background; WhatsApp expects a fast 200.
    void rt.graph.invoke(new Command({ resume: approval }), { configurable: { thread_id: threadId } })
      .catch((err) => console.error("resume failed", err));
  }
  return c.text("ok");
});

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`keel-api listening on :${port}`);
