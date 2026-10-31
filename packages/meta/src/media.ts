import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { REPO_ROOT } from "./config.ts";

/**
 * Where Keel keeps images it captured (rendered previews, original creatives, generated replacements).
 * Content-addressed, so the same bytes are stored once. Refs are `file://` paths inside MEDIA_DIR.
 */
export const mediaDir = () => resolve(process.env.MEDIA_DIR ?? join(REPO_ROOT, ".data/media"));

const EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg" };
export const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };

export async function saveMedia(bytes: Buffer, ext = ".png", folder = "captured"): Promise<string> {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const dir = join(mediaDir(), folder);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${hash}${ext.startsWith(".") ? ext : `.${ext}`}`);
  await writeFile(path, bytes);
  return `file://${path}`;
}

/** Downloads a remote image (Meta CDN URLs expire) into the media store. Returns the original URL if that fails. */
export async function captureRemote(url: string, folder = "originals"): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    const ext = EXT[type] ?? (extname(new URL(url).pathname) || ".jpg");
    return await saveMedia(Buffer.from(await res.arrayBuffer()), ext, folder);
  } catch {
    return url;
  }
}

export async function readMedia(ref: string): Promise<{ bytes: Buffer; mime: string }> {
  if (ref.startsWith("file://")) {
    const path = ref.slice(7);
    return { bytes: await readFile(path), mime: MIME[extname(path).toLowerCase()] ?? "application/octet-stream" };
  }
  const res = await fetch(ref);
  if (!res.ok) throw new Error(`fetch ${ref}: ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "image/jpeg" };
}
