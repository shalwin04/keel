/** Fail fast on a broken production config; warn about optional features that are off. */
export function checkEnv() {
  const prod = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warn: string[] = [];
  if (!process.env.DATABASE_URL) errors.push("DATABASE_URL is required");
  const secret = process.env.KEEL_SECRET ?? "";
  if (prod && secret.length < 32) errors.push("KEEL_SECRET must be at least 32 characters in production (openssl rand -hex 32)");
  if (prod && !process.env.PUBLIC_BASE_URL?.startsWith("https://")) errors.push("PUBLIC_BASE_URL must be your https:// URL in production");
  if (prod && process.env.DEV_AUTH === "1") errors.push("DEV_AUTH must be off in production");
  if (!process.env.META_API_KEY) warn.push("META_API_KEY not set: model checks will fail");
  if (!process.env.META_APP_ID) warn.push("Facebook Login not configured: only demo/dev sign-in available");
  if (!process.env.VAPID_PUBLIC_KEY) warn.push("VAPID keys not set: phone alerts are off");
  for (const w of warn) console.warn(`[keel] ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[keel] config error: ${e}`);
    process.exit(1);
  }
}
