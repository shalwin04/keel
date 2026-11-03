import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Move } from "@keel/core";
import { type createMarketing, type createRuntime } from "@keel/agents";
import { schema } from "@keel/db";
import { assertPublicUrl } from "@keel/meta";
import { accessTo, accountsFor } from "./access.ts";
import type { AppEnv } from "./env.ts";

type Runtime = Awaited<ReturnType<typeof createRuntime>>;

const StartBody = z.object({
  accountId: z.string().regex(/^act_\d+$/),
  url: z.string().min(4).max(500),
  dailyBudget: z.number().positive().max(1_000_000),
  maxDailyBudget: z.number().positive().max(10_000_000).optional(),
  checkEveryHours: z.number().min(1).max(72).optional(),
  objective: z.enum(["traffic", "sales"]).optional(),
});
/** Moves that spend more money need an owner; the rest can be approved by a reviewer. */
const OWNER_ONLY = new Set<Move["kind"]>(["go_live", "scale_budget"]);

/** Autopilot API: paste a website, the agent researches, crafts, launches on approval, learns and proposes updates. */
export function autopilotRoutes(rt: Runtime, { autopilot }: ReturnType<typeof createMarketing>) {
  const { db } = rt;
  const r = new Hono<AppEnv>();

  async function find(userId: string, id: string, write = false) {
    const ap = await autopilot.get(id);
    if (!ap) return undefined;
    const access = await accessTo(db, userId, ap.accountId);
    if (!access || (write && access.role === "viewer")) return undefined;
    return { ap, access };
  }

  async function covers(projectId: string | null) {
    if (!projectId) return [];
    const rows = await db.select({ ref: schema.studioDesigns.renderRef, direction: schema.studioDesigns.direction }).from(schema.studioDesigns)
      .where(and(eq(schema.studioDesigns.projectId, projectId), eq(schema.studioDesigns.size, "square")));
    return rows.sort((a, b) => a.direction - b.direction).map((x) => x.ref);
  }

  r.get("/", async (c) => {
    const ws = [...new Set((await accountsFor(db, c.get("user").id)).map((a) => a.workspaceId))];
    const rows = await autopilot.list(ws);
    return c.json(await Promise.all(rows.map(async (a) => ({
      id: a.id, url: a.url, status: a.status, accountId: a.accountId, createdAt: a.createdAt, error: a.error,
      brand: (a.profile as { brand?: { name: string } } | null)?.brand?.name ?? null,
      logoRef: (a.site as { logoRef?: string } | null)?.logoRef ?? null,
      pending: ((a.moves ?? []) as Move[]).filter((m) => m.status === "pending").length,
      covers: await covers(a.projectId),
    }))));
  });

  r.post("/", async (c) => {
    const user = c.get("user");
    const body = StartBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    const access = await accessTo(db, user.id, body.data.accountId);
    if (!access || access.role === "viewer") return c.json({ error: "you can't create campaigns in this account" }, 403);
    if (access.isDemo) return c.json({ error: "the demo workspace has no live ad account; connect yours in Settings" }, 409);
    let url: URL;
    try { url = await assertPublicUrl(body.data.url.trim()); } catch (err) { return c.json({ error: (err as Error).message }, 400); }
    const id = await autopilot.start({ workspaceId: access.workspaceId, brandId: access.brandId, accountId: body.data.accountId, url: url.href, userId: user.id, dailyBudget: body.data.dailyBudget, maxDailyBudget: body.data.maxDailyBudget, checkEveryHours: body.data.checkEveryHours, objective: body.data.objective });
    return c.json({ id }, 201);
  });

  r.get("/:id", async (c) => {
    const found = await find(c.get("user").id, c.req.param("id"));
    if (!found) return c.json({ error: "not found" }, 404);
    const { ap } = found;
    const [p] = ap.projectId ? await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, ap.projectId)) : [];
    const designs = p ? await db.select({ id: schema.studioDesigns.id, direction: schema.studioDesigns.direction, size: schema.studioDesigns.size, renderRef: schema.studioDesigns.renderRef, picked: schema.studioDesigns.picked, check: schema.studioDesigns.check })
      .from(schema.studioDesigns).where(and(eq(schema.studioDesigns.projectId, p.id), eq(schema.studioDesigns.size, "portrait"))) : [];
    return c.json({
      ...ap, role: found.access.role,
      project: p ? {
        id: p.id, name: p.name, status: p.status, steps: p.steps, error: p.error, brief: p.brief, launch: p.launch, log: p.log,
        research: p.research ? { insights: (p.research as { insights: unknown }).insights, ads: ((p.research as { ads: unknown[] }).ads ?? []).length } : null,
        directions: ((p.directions ?? []) as { title: string; angle: string; hook: string; headline: string; rationale?: string; palette: unknown }[]).map((d) => ({ title: d.title, angle: d.angle, hook: d.hook, headline: d.headline, rationale: d.rationale, palette: d.palette })),
        designs: designs.sort((a, b) => a.direction - b.direction),
      } : null,
    });
  });

  r.post("/:id/launch", async (c) => {
    const user = c.get("user");
    const found = await find(user.id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    if (found.access.role !== "owner") return c.json({ error: "only owners can launch campaigns" }, 403);
    const { live } = (await c.req.json().catch(() => ({}))) as { live?: boolean };
    try {
      await autopilot.launch(found.ap.id, user.id, !!live);
      return c.json({ ok: true }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  r.post("/:id/check", async (c) => {
    const found = await find(c.get("user").id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    if (found.ap.status !== "live") return c.json({ error: "the campaign isn't live" }, 409);
    await autopilot.check(found.ap.id);
    return c.json({ ok: true });
  });

  r.post("/:id/moves/:moveId", async (c) => {
    const user = c.get("user");
    const found = await find(user.id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    const move = ((found.ap.moves ?? []) as Move[]).find((m) => m.id === c.req.param("moveId"));
    if (!move) return c.json({ error: "not found" }, 404);
    const { approve } = (await c.req.json().catch(() => ({}))) as { approve?: boolean };
    if (approve && OWNER_ONLY.has(move.kind) && found.access.role !== "owner") return c.json({ error: "only owners can approve changes that spend more" }, 403);
    try {
      return c.json(await autopilot.decide(found.ap.id, move.id, user.id, !!approve));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  r.post("/:id/:action{stop|resume}", async (c) => {
    const user = c.get("user");
    const found = await find(user.id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    await autopilot.setStopped(found.ap.id, c.req.param("action") === "stop", user.id);
    return c.json({ ok: true });
  });

  r.post("/:id/retry", async (c) => {
    const found = await find(c.get("user").id, c.req.param("id"), true);
    if (!found) return c.json({ error: "not found" }, 404);
    if (found.ap.status !== "failed") return c.json({ error: "only a failed run can be retried" }, 409);
    void autopilot.run(found.ap.id);
    return c.json({ ok: true }, 202);
  });

  return r;
}
