import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { BriefSchema, DesignDocSchema, FORMATS, TEMPLATES, VISUAL_STYLES } from "@keel/core";
import { type createMarketing, type createRuntime } from "@keel/agents";
import { schema } from "@keel/db";
import { readMedia, saveMedia } from "@keel/meta";
import { accessTo, accountsFor } from "./access.ts";
import type { AppEnv } from "./env.ts";

type Runtime = Awaited<ReturnType<typeof createRuntime>>;

const CreateBody = z.object({ accountId: z.string().regex(/^act_\d+$/), name: z.string().min(1).max(80), brief: BriefSchema });
const PatchDesign = z.object({ doc: DesignDocSchema.optional(), picked: z.boolean().optional() });
const UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Keel Studio API: make campaigns from a brief, edit the layered designs, launch paused with guardrails. */
export function studioRoutes(rt: Runtime, { studio, memory }: ReturnType<typeof createMarketing>) {
  const { db } = rt;
  const r = new Hono<AppEnv>();

  async function projectFor(userId: string, id: string, write = false) {
    const [p] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, id));
    if (!p) return undefined;
    const access = await accessTo(db, userId, p.accountId);
    if (!access || (write && access.role === "viewer")) return undefined;
    return { p, access };
  }

  r.post("/uploads", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "attach an image as `file`" }, 400);
    if (!UPLOAD_TYPES.has(file.type)) return c.json({ error: "PNG, JPEG or WebP only" }, 400);
    if (file.size > 15 * 1024 * 1024) return c.json({ error: "images up to 15 MB" }, 413);
    const ref = await saveMedia(Buffer.from(await file.arrayBuffer()), file.type === "image/jpeg" ? ".jpg" : file.type === "image/webp" ? ".webp" : ".png", "uploads");
    return c.json({ ref }, 201);
  });

  r.get("/projects", async (c) => {
    const ws = [...new Set((await accountsFor(db, c.get("user").id)).map((a) => a.workspaceId))];
    return c.json(await studio.list(ws));
  });

  r.post("/projects", async (c) => {
    const user = c.get("user");
    const body = CreateBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    const access = await accessTo(db, user.id, body.data.accountId);
    if (!access || access.role === "viewer") return c.json({ error: "you can't create campaigns in this account" }, 403);
    if (access.isDemo) return c.json({ error: "the demo workspace has no live ad account; connect yours in Settings" }, 409);
    if (new Date(body.data.brief.endDate) <= new Date(body.data.brief.startDate)) return c.json({ error: "end date must be after the start date" }, 400);
    const id = await studio.create({ workspaceId: access.workspaceId, brandId: access.brandId, accountId: body.data.accountId, name: body.data.name, brief: body.data.brief, userId: user.id });
    return c.json({ id }, 201);
  });

  r.get("/projects/:id", async (c) => {
    const found = await projectFor(c.get("user").id, c.req.param("id"));
    if (!found) return c.json({ error: "not found" }, 404);
    const designs = await db.select().from(schema.studioDesigns).where(eq(schema.studioDesigns.projectId, found.p.id));
    return c.json({ ...found.p, role: found.access.role, designs: designs.sort((a, b) => a.direction - b.direction || a.size.localeCompare(b.size)) });
  });

  r.patch("/designs/:id", async (c) => {
    const [d] = await db.select().from(schema.studioDesigns).where(eq(schema.studioDesigns.id, c.req.param("id")));
    if (!d || !(await projectFor(c.get("user").id, d.projectId, true))) return c.json({ error: "not found" }, 404);
    const body = PatchDesign.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.message }, 400);
    if (body.data.picked !== undefined) {
      // Picking a design picks its whole direction (all sizes travel together).
      await db.update(schema.studioDesigns).set({ picked: body.data.picked }).where(and(eq(schema.studioDesigns.projectId, d.projectId), eq(schema.studioDesigns.direction, d.direction)));
    }
    const renderRef = body.data.doc ? await studio.saveDesign(d.id, body.data.doc) : d.renderRef;
    return c.json({ ok: true, renderRef });
  });

  r.post("/projects/:id/directions/:n/scene", async (c) => {
    const found = await projectFor(c.get("user").id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    try {
      return c.json({ sceneRef: await studio.regenerateScene(found.p.id, Number(c.req.param("n"))) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  r.post("/projects/:id/directions/:n/use-scene", async (c) => {
    const found = await projectFor(c.get("user").id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    const { ref } = (await c.req.json().catch(() => ({}))) as { ref?: string };
    const dir = ((found.p.directions ?? []) as { sceneHistory?: string[] }[])[Number(c.req.param("n"))];
    if (!ref || !dir?.sceneHistory?.includes(ref)) return c.json({ error: "unknown scene" }, 400);
    await studio.useScene(found.p.id, Number(c.req.param("n")), ref);
    return c.json({ ok: true });
  });

  r.post("/projects/:id/directions/:n/template", async (c) => {
    const found = await projectFor(c.get("user").id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    const t = z.enum(TEMPLATES).safeParse(((await c.req.json().catch(() => ({}))) as { template?: string }).template);
    if (!t.success) return c.json({ error: "template must be hero, split or card" }, 400);
    await studio.changeTemplate(found.p.id, Number(c.req.param("n")), t.data);
    return c.json({ ok: true });
  });

  r.post("/projects/:id/directions/:n/storyboard", async (c) => {
    const found = await projectFor(c.get("user").id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    try {
      return c.json({ frames: await studio.drawStoryboard(found.p.id, Number(c.req.param("n"))) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  // ── Concept board ────────────────────────────────────────────────────────
  r.post("/projects/:id/concepts", async (c) => {
    const found = await projectFor(c.get("user").id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    if ((found.p.concepts as { status?: string } | null)?.status === "making") return c.json({ error: "the agent is already making concepts" }, 409);
    const body = z.object({ count: z.number().int().min(1).max(16).optional(), formats: z.array(z.enum(FORMATS)).optional(), remixOf: z.string().optional(), style: z.enum(VISUAL_STYLES).optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.message }, 400);
    void studio.makeConcepts(found.p.id, body.data).catch(() => undefined);
    return c.json({ ok: true }, 202);
  });

  r.post("/projects/:id/concepts/add", async (c) => {
    const user = c.get("user");
    const found = await projectFor(user.id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    if (found.p.status === "launched" && found.access.role !== "owner") return c.json({ error: "only owners can add ads to a live campaign" }, 403);
    const ids = z.array(z.string()).min(1).max(16).safeParse(((await c.req.json().catch(() => ({}))) as { ids?: unknown }).ids);
    if (!ids.success) return c.json({ error: "pick at least one concept" }, 400);
    try {
      return c.json({ added: await studio.addConcepts(found.p.id, ids.data, user.id) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  // ── Refine: one precise Muse Image edit ──────────────────────────────────
  const Refine = z.object({ instruction: z.string().trim().min(3).max(300) });
  r.post("/designs/:id/refine", async (c) => {
    const user = c.get("user");
    const [des] = await db.select().from(schema.studioDesigns).where(eq(schema.studioDesigns.id, c.req.param("id")));
    if (!des || !(await projectFor(user.id, des.projectId, true))) return c.json({ error: "not found" }, 404);
    const body = Refine.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "say what to change, in a few words" }, 400);
    try { return c.json({ renderRef: await studio.refine(des.id, body.data.instruction, user.id) }); }
    catch (err) { return c.json({ error: (err as Error).message }, 422); }
  });
  r.post("/projects/:id/concepts/:cid/refine", async (c) => {
    const user = c.get("user");
    const found = await projectFor(user.id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    const body = Refine.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "say what to change, in a few words" }, 400);
    try { return c.json({ renderRef: await studio.refineConcept(found.p.id, c.req.param("cid"), body.data.instruction, user.id) }); }
    catch (err) { return c.json({ error: (err as Error).message }, 422); }
  });

  // ── Brand memory: what has worked for this brand ─────────────────────────
  r.get("/memory", async (c) => {
    const access = await accessTo(db, c.get("user").id, c.req.query("accountId") ?? "");
    if (!access) return c.json({ error: "not found" }, 404);
    return c.json((await memory.get(access.brandId)) ?? null);
  });
  const refreshing = new Set<string>();
  r.post("/memory/refresh", async (c) => {
    const user = c.get("user");
    const { accountId } = (await c.req.json().catch(() => ({}))) as { accountId?: string };
    const access = await accessTo(db, user.id, accountId ?? "");
    if (!access || access.role === "viewer") return c.json({ error: "not found" }, 404);
    if (access.isDemo) return c.json({ error: "the demo workspace has no live ad account" }, 409);
    if (!refreshing.has(access.brandId)) {
      refreshing.add(access.brandId);
      void memory.refresh(access.brandId, user.id).catch(() => undefined).finally(() => refreshing.delete(access.brandId));
    }
    return c.json({ ok: true }, 202);
  });
  r.get("/memory/status", async (c) => {
    const access = await accessTo(db, c.get("user").id, c.req.query("accountId") ?? "");
    return c.json({ refreshing: !!access && refreshing.has(access.brandId) });
  });

  r.post("/projects/:id/retry", async (c) => {
    const found = await projectFor(c.get("user").id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    await db.update(schema.studioProjects).set({ status: "drafting", error: null, log: [], steps: found.p.steps && (found.p.steps as { status: string }[]).map((s) => ({ ...s, status: "waiting", detail: undefined, ms: undefined })) }).where(eq(schema.studioProjects.id, found.p.id));
    void studio.run(found.p.id);
    return c.json({ ok: true }, 202);
  });

  r.post("/projects/:id/launch", async (c) => {
    const user = c.get("user");
    const found = await projectFor(user.id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    if (found.access.role !== "owner") return c.json({ error: "only owners can launch campaigns" }, 403);
    try {
      return c.json(await studio.launch(found.p.id, user.id), 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  r.get("/designs/:id/download", async (c) => {
    const [d] = await db.select().from(schema.studioDesigns).where(eq(schema.studioDesigns.id, c.req.param("id")));
    if (!d?.renderRef || !(await projectFor(c.get("user").id, d.projectId))) return c.json({ error: "not found" }, 404);
    const m = await readMedia(d.renderRef);
    return c.body(new Uint8Array(m.bytes), 200, { "Content-Type": m.mime, "Content-Disposition": `attachment; filename="keel-${d.size}-${d.id.slice(0, 8)}${m.mime === "image/webp" ? ".webp" : ".png"}"` });
  });

  return r;
}
