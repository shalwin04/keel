/**
 * Probes the Meta Model API for what Studio needs, and saves every raw response so Studio can be
 * wired to the real formats.  npm run studio:probe -- path/to/product.png
 *
 * Writes .data/probe/: models.json, image-*.json/png, sam.json, spark.json, and prints a summary.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const base = process.env.META_API_BASE ?? "https://api.meta.ai/v1";
const key = process.env.META_API_KEY;
if (!key) throw new Error("META_API_KEY is not set");
const photo = process.argv[2];
if (!photo) throw new Error("Pass a product photo: npm run studio:probe -- path/to/product.png");
const out = ".data/probe";
await mkdir(out, { recursive: true });
const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(photo).toLowerCase()] ?? "image/png";
const dataUrl = `data:${mime};base64,${(await readFile(photo)).toString("base64")}`;
const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const model = (k: string, d: string) => process.env[k] ?? d;

async function call(name: string, path: string, body?: unknown, method = "POST") {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180_000) });
    const text = await res.text();
    let json: unknown = text;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    await writeFile(join(out, `${name}.json`), JSON.stringify({ status: res.status, ms: Date.now() - t0, body: json }, null, 2).slice(0, 5_000_000));
    // Save any images that came back.
    const found: string[] = [];
    const walk = (n: unknown) => {
      if (typeof n === "string" && n.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(n.slice(0, 200))) found.push(n);
      else if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") Object.values(n).forEach(walk);
    };
    walk(json);
    for (const [i, b64] of found.slice(0, 4).entries()) await writeFile(join(out, `${name}-${i}.png`), Buffer.from(b64, "base64"));
    const shape = (n: unknown, d = 0): unknown => d > 3 ? "…" : Array.isArray(n) ? [n.length ? shape(n[0], d + 1) : "[]"] : n && typeof n === "object"
      ? Object.fromEntries(Object.entries(n).map(([k, v]) => [k, typeof v === "string" ? (v.length > 60 ? `string(${v.length})` : v) : shape(v, d + 1)])) : n;
    console.log(`\n■ ${name}: HTTP ${res.status} in ${Date.now() - t0} ms`);
    console.log(JSON.stringify(shape(json), null, 1).slice(0, 1500));
    if (found.length) console.log(`  saved ${Math.min(found.length, 4)} image(s) to ${out}/${name}-*.png`);
  } catch (err) {
    console.log(`\n■ ${name}: FAILED ${(err as Error).message}`);
  }
}

await call("models", "/models", undefined, "GET");

const img = model("MODEL_IMAGE", "muse-image-1.0");
const scene = "A rainy Mumbai street at dusk, soft bokeh lights, wet reflective pavement, cinematic, empty space in the centre for a product. No text, no logos, no people.";
await call("image-generate", "/images/generations", { model: img, prompt: scene, size: "1024x1024", n: 1, response_format: "b64_json" });
await call("image-generate-with-reference", "/images/generations", {
  model: img, n: 1, size: "1024x1024", response_format: "b64_json",
  prompt: `Place this exact jacket, unchanged, on a rack in: ${scene}`, reference_images: [dataUrl],
});
await call("image-edit-responses", "/responses", {
  model: img,
  input: [{ role: "user", content: [{ type: "input_image", image_url: dataUrl }, { type: "input_text", text: "Keep the product exactly as it is. Replace only the background with: " + scene }] }],
});
await call("sam", "/responses", {
  model: model("MODEL_SAM", "sam-3.1"),
  input: [{ role: "user", content: [{ type: "input_image", image_url: dataUrl }, { type: "input_text", text: "product, jacket, logo, text" }] }],
});
await call("spark", "/chat/completions", {
  model: model("MODEL_SPARK", "muse-spark-1.3"),
  messages: [{ role: "user", content: [{ type: "text", text: "Describe this product in one sentence and list its 3 dominant colours as hex." }, { type: "image_url", image_url: { url: dataUrl } }] }],
});
console.log(`\nDone. Send me this output (and ${out}/*.json if something failed).`);
