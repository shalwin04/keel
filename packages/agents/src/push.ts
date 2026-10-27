import webpush from "web-push";

let configured = false;
function configure() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT ?? "mailto:keel@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  return (configured = true);
}

export interface PushTarget { endpoint: string; keys: { p256dh: string; auth: string } }
export interface PushMessage { title: string; body: string; url: string; tag?: string }

/** Sends to every subscription; returns endpoints that are gone (410/404) so callers can delete them. */
export async function sendPush(targets: PushTarget[], msg: PushMessage): Promise<string[]> {
  if (!configure()) return [];
  const gone: string[] = [];
  await Promise.all(targets.map(async (t) => {
    try {
      await webpush.sendNotification(t, JSON.stringify(msg), { TTL: 6 * 3600, urgency: "high" });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(t.endpoint);
    }
  }));
  return gone;
}
