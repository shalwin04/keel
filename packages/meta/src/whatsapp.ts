import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";

export interface CardButton { id: string; title: string } // title ≤ 20 chars, max 3 buttons

/** Interactive reply-button message with an image header (the side-by-side card). */
export async function sendFindingCard(to: string, imageUrl: string, body: string, buttons: CardButton[]) {
  const res = await fetch(`https://graph.facebook.com/${config.graph.version}/${config.whatsapp.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        header: { type: "image", image: { link: imageUrl } },
        body: { text: body.slice(0, 1024) },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Verify Meta's X-Hub-Signature-256 header on webhook payloads. */
export function verifyWebhookSignature(rawBody: string, header: string | undefined, secret = config.whatsapp.appSecret) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
