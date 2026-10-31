import type { MiddlewareHandler } from "hono";

/** Fixed-window, per-IP limiter. In-memory: fine for one API instance; put a shared store behind it to scale out. */
export function rateLimit(o: { windowMs: number; max: number }): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, o.windowMs).unref();
  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
    const now = Date.now();
    const cur = hits.get(ip);
    const entry = cur && cur.reset > now ? cur : { n: 0, reset: now + o.windowMs };
    entry.n++;
    hits.set(ip, entry);
    if (entry.n > o.max) {
      c.header("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return c.json({ error: "too many requests, slow down" }, 429);
    }
    await next();
  };
}
