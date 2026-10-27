import { api } from "./api.ts";

const toKey = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
};

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window;

/** Registers the service worker and subscribes this device to review alerts. */
export async function enablePush(): Promise<"enabled" | "denied" | "unavailable"> {
  if (!pushSupported()) return "unavailable";
  const { publicKey } = await api.pushKey();
  if (!publicKey) return "unavailable";
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const reg = await navigator.serviceWorker.register("/sw.js");
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
  await api.pushSubscribe(sub.toJSON());
  return "enabled";
}
