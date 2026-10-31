import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { createRuntime } from "@keel/agents";
import { REPO_ROOT } from "@keel/meta";
import { authRoutes, requireUser } from "./auth.ts";
import { checkEnv } from "./config.ts";
import type { AppEnv } from "./env.ts";
import { createEventHub } from "./events.ts";
import { rateLimit } from "./ratelimit.ts";
import { apiRoutes } from "./routes.ts";

checkEnv();
const rt = await createRuntime();
const hub = await createEventHub(rt.db, process.env.DATABASE_URL!);
const publicBase = process.env.PUBLIC_BASE_URL ?? "http://localhost:8787";
const webOrigin = process.env.WEB_BASE_URL ?? publicBase;
const allowedOrigins = [...new Set([webOrigin, publicBase].map((u) => new URL(u).origin))];
const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), svc: "keel-api", ...o }));

const app = new Hono<AppEnv>();

app.use(async (c, next) => {
  const t0 = Date.now();
  await next();
  if (c.req.path !== "/health" && !c.req.path.startsWith("/assets/")) log({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t0 });
});
app.use(secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", "data:", "blob:", "https:"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    scriptSrc: ["'self'"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", "data:"],
    frameAncestors: ["'none'"],
  },
  crossOriginEmbedderPolicy: false,
}));
// Same-site cookies, plus an Origin check on every state-changing request (forms and JSON alike).
app.use(csrf({ origin: allowedOrigins }));
app.use(async (c, next) => {
  const origin = c.req.header("origin");
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && origin && !allowedOrigins.includes(origin)) {
    return c.json({ error: "cross-origin request blocked" }, 403);
  }
  await next();
});

app.get("/health", async (c) => {
  try {
    await rt.pool.query("select 1");
    return c.json({ ok: true, service: "keel-api" });
  } catch {
    return c.json({ ok: false, service: "keel-api", db: "unreachable" }, 503);
  }
});
app.use("/auth/*", rateLimit({ windowMs: 60_000, max: 30 }));
app.route("/auth", authRoutes(rt.db));
app.use("/api/*", rateLimit({ windowMs: 60_000, max: 600 }));
app.use("/api/*", requireUser(rt.db));
app.route("/api", apiRoutes(rt, hub));
app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/auth/")) return c.json({ error: "not found" }, 404);
  return c.text("not found", 404);
});
app.onError((err, c) => {
  log({ level: "error", path: c.req.path, error: err.message });
  return c.json({ error: "something went wrong on our side" }, 500);
});

// Production: the API serves the built web app too, so it's one origin and one deploy.
const webDist = resolve(process.env.WEB_DIST ?? join(REPO_ROOT, "apps/web/dist"));
if (existsSync(join(webDist, "index.html"))) {
  const indexHtml = await readFile(join(webDist, "index.html"), "utf8");
  app.use("/assets/*", serveStatic({ root: webDist, onFound: (_p, c) => { c.header("Cache-Control", "public, max-age=31536000, immutable"); } }));
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", (c) => c.html(indexHtml));
  log({ msg: "serving web app", dir: webDist });
}

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const server = serve({ fetch: app.fetch, port });
log({ msg: `listening on :${port}` });

const stop = async () => {
  log({ msg: "shutting down" });
  server.close();
  await hub.stop();
  await rt.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
