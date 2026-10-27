import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { logger } from "hono/logger";
import { createRuntime } from "@keel/agents";
import { authRoutes, requireUser } from "./auth.ts";
import type { AppEnv } from "./env.ts";
import { createEventHub } from "./events.ts";
import { apiRoutes } from "./routes.ts";

const rt = await createRuntime();
const hub = await createEventHub(rt.db, process.env.DATABASE_URL!);
const webOrigin = process.env.WEB_BASE_URL ?? "http://localhost:5173";

const app = new Hono<AppEnv>();
app.use(logger());
// Same-site cookies, plus an Origin check on every state-changing request (forms and JSON alike).
const allowedOrigins = [webOrigin, process.env.PUBLIC_BASE_URL ?? "http://localhost:8787"];
app.use(csrf({ origin: allowedOrigins }));
app.use(async (c, next) => {
  const origin = c.req.header("origin");
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && origin && !allowedOrigins.includes(origin)) {
    return c.json({ error: "cross-origin request blocked" }, 403);
  }
  await next();
});

app.get("/health", (c) => c.json({ ok: true, service: "keel-api" }));
app.route("/auth", authRoutes(rt.db));
app.use("/api/*", requireUser(rt.db));
app.route("/api", apiRoutes(rt, hub));

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`keel-api listening on :${port}`);
