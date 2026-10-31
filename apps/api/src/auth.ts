import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { DEMO_WORKSPACE_ID, encrypt, schema, type Db } from "@keel/db";
import { config } from "@keel/meta";
import type { AppEnv, SessionUser } from "./env.ts";

const SESSION_COOKIE = "keel_session";
const STATE_COOKIE = "keel_oauth_state";
const SESSION_DAYS = 14;
const secret = () => process.env.KEEL_SECRET ?? "dev-only-secret-change-me-0000000000";
const secure = () => (process.env.PUBLIC_BASE_URL ?? "").startsWith("https://");
const webUrl = (path = "/") => `${process.env.WEB_BASE_URL ?? "http://localhost:5173"}${path}`;

async function startSession(c: Parameters<MiddlewareHandler>[0], db: Db, userId: string) {
  const id = randomBytes(24).toString("base64url");
  await db.insert(schema.sessions).values({ id, userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) });
  await setSignedCookie(c, SESSION_COOKIE, id, secret(), {
    httpOnly: true, sameSite: "Lax", secure: secure(), path: "/", maxAge: SESSION_DAYS * 86_400,
  });
}

export function requireUser(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const sid = await getSignedCookie(c, secret(), SESSION_COOKIE);
    if (!sid) return c.json({ error: "unauthenticated" }, 401);
    const [row] = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(and(eq(schema.sessions.id, sid), gt(schema.sessions.expiresAt, new Date())));
    if (!row) return c.json({ error: "unauthenticated" }, 401);
    c.set("user", row satisfies SessionUser);
    await next();
  };
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${config.graph.version}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Graph ${res.status}`);
  return json;
}

/** Facebook Login for Business (sign-in + ad permissions in one step), plus demo and dev logins. */
export function authRoutes(db: Db) {
  const r = new Hono<AppEnv>();
  const redirectUri = () => `${process.env.PUBLIC_BASE_URL}/auth/meta/callback`;

  /** Which sign-in options this deployment offers (the login page shows only these). */
  r.get("/options", (c) => c.json({
    facebook: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_LOGIN_CONFIG_ID),
    demo: process.env.DEMO_ENABLED === "1",
    dev: process.env.DEV_AUTH === "1",
  }));

  r.get("/meta/start", async (c) => {
    if (!process.env.META_APP_ID || !process.env.META_LOGIN_CONFIG_ID) return c.redirect(webUrl("/login?error=facebook-not-configured"));
    const state = randomBytes(16).toString("base64url");
    await setSignedCookie(c, STATE_COOKIE, state, secret(), { httpOnly: true, sameSite: "Lax", secure: secure(), path: "/", maxAge: 600 });
    const url = new URL(`https://www.facebook.com/${config.graph.version}/dialog/oauth`);
    url.searchParams.set("client_id", config.facebook.appId);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("config_id", config.facebook.loginConfigId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    return c.redirect(url.toString());
  });

  r.get("/meta/callback", async (c) => {
    const { code, state } = c.req.query();
    const expected = await getSignedCookie(c, secret(), STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/" });
    if (!code || !state || state !== expected) return c.redirect(webUrl("/login?error=state"));

    try {
    const short = await graph<{ access_token: string }>("oauth/access_token", {
      client_id: config.facebook.appId, client_secret: config.facebook.appSecret, redirect_uri: redirectUri(), code,
    });
    const long = await graph<{ access_token: string; expires_in?: number }>("oauth/access_token", {
      grant_type: "fb_exchange_token", client_id: config.facebook.appId, client_secret: config.facebook.appSecret,
      fb_exchange_token: short.access_token,
    });
    const me = await graph<{ id: string; name: string; email?: string }>("me", { fields: "id,name,email", access_token: long.access_token });

    let [user] = await db.select().from(schema.users).where(eq(schema.users.metaUserId, me.id));
    let workspaceId: string;
    if (!user) {
      [user] = await db.insert(schema.users).values({ id: randomUUID(), name: me.name, email: me.email, metaUserId: me.id }).returning();
      workspaceId = randomUUID();
      await db.insert(schema.workspaces).values({ id: workspaceId, name: `${me.name.split(" ")[0]}'s workspace` });
      await db.insert(schema.memberships).values({ workspaceId, userId: user!.id, role: "owner" });
    } else {
      const owned = await db.select({ workspaceId: schema.memberships.workspaceId, isDemo: schema.workspaces.isDemo })
        .from(schema.memberships).innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
        .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.role, "owner")));
      const own = owned.find((m) => !m.isDemo);
      if (own) workspaceId = own.workspaceId;
      else {
        workspaceId = randomUUID();
        await db.insert(schema.workspaces).values({ id: workspaceId, name: `${me.name.split(" ")[0]}'s workspace` });
        await db.insert(schema.memberships).values({ workspaceId, userId: user.id, role: "owner" });
      }
    }
    await db.insert(schema.metaConnections).values({
      id: randomUUID(), workspaceId, userId: user!.id, tokenEnc: encrypt(long.access_token), scopes: [],
      expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
    });
    await startSession(c, db, user!.id);
    return c.redirect(webUrl("/onboarding"));
    } catch (err) {
      console.error("[keel] facebook login failed", err);
      return c.redirect(webUrl(`/login?error=${encodeURIComponent((err as Error).message.slice(0, 120))}`));
    }
  });

  /** Read-only tour of the seeded demo workspace, for judges. */
  r.post("/demo", async (c) => {
    if (process.env.DEMO_ENABLED !== "1") return c.json({ error: "demo disabled" }, 404);
    const userId = "user_demo_viewer";
    await db.insert(schema.users).values({ id: userId, name: "Demo viewer" }).onConflictDoNothing();
    await db.insert(schema.memberships).values({ workspaceId: DEMO_WORKSPACE_ID, userId, role: "viewer" }).onConflictDoNothing();
    await startSession(c, db, userId);
    return c.json({ ok: true });
  });

  /** Local development only: sign in as the demo workspace owner. */
  r.post("/dev", async (c) => {
    if (process.env.DEV_AUTH !== "1") return c.json({ error: "dev auth disabled" }, 404);
    await startSession(c, db, "user_demo_owner");
    return c.json({ ok: true });
  });

  r.post("/logout", async (c) => {
    const sid = await getSignedCookie(c, secret(), SESSION_COOKIE);
    if (sid) await db.delete(schema.sessions).where(eq(schema.sessions.id, sid));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  return r;
}
