/**
 * What Muse Image accepts on this account: sizes and aspect ratios, several reference images, and in-image text.
 *   npm run image:probe
 * Saves every image to .data/probe/ and prints its real size. Paste the output back to tune MUSE_IMAGE_SIZES.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callJson, config, metaClient, REPO_ROOT, renderSvgToPng } from "@keel/meta";
import { z } from "zod";

const out = join(REPO_ROOT, ".data/probe");
await mkdir(out, { recursive: true });
const base = config.metaApiBase, key = config.metaApiKey, model = config.models.image;

function dims(b: Buffer): string {
  if (b.subarray(0, 4).toString("hex") === "89504e47") return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)} png`;
  if (b.subarray(0, 4).toString("ascii") === "RIFF") {
    const kind = b.subarray(12, 16).toString("ascii");
    if (kind === "VP8X") return `${1 + b.readUIntLE(24, 3)}x${1 + b.readUIntLE(27, 3)} webp`;
    if (kind === "VP8 ") return `${b.readUInt16LE(26) & 0x3fff}x${b.readUInt16LE(28) & 0x3fff} webp`;
    if (kind === "VP8L") { const n = b.readUInt32LE(21); return `${(n & 0x3fff) + 1}x${((n >> 14) & 0x3fff) + 1} webp`; }
  }
  if (b.subarray(0, 3).toString("hex") === "ffd8ff") return "jpeg";
  return "unknown";
}
const save = async (name: string, b64: string) => { const b = Buffer.from(b64, "base64"); await writeFile(join(out, `${name}.webp`), b); return dims(b); };
const t = () => Date.now();

console.log(`Muse Image probe · ${model} · ${base}\n`);
console.log("■ Text to image (/images/generations)");
for (const extra of [{ size: "1024x1024" }, { size: "1024x1280" }, { size: "1024x1536" }, { size: "1024x1792" }, { size: "1080x1350" }, { aspect_ratio: "4:5" }, { aspect_ratio: "9:16" }, { size: "auto" }]) {
  const t0 = t();
  const res = await fetch(`${base}/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: "A rain-soaked city street at dusk, cinematic, no text.", n: 1, response_format: "b64_json", ...extra }) });
  const j = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
  const got = j.data?.[0]?.b64_json ? await save(`gen-${Object.values(extra)[0]!.replace(/[:x]/g, "_")}`, j.data[0].b64_json) : "";
  console.log(`  ${JSON.stringify(extra).padEnd(26)} HTTP ${res.status} ${got ? `→ ${got}` : (j.error?.message ?? "").slice(0, 120)} (${((t() - t0) / 1000).toFixed(0)} s)`);
}

const product = (await renderSvgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#fff"/><path d="M250 150 Q400 110 550 150 L680 230 L720 520 L640 540 L620 400 L620 700 L180 700 L180 400 L160 540 L80 520 L120 230 Z" fill="#14324A"/><line x1="400" y1="170" x2="400" y2="700" stroke="#E0A23B" stroke-width="10"/></svg>`, 800, 800)).toString("base64");
const logo = (await renderSvgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect width="600" height="160" fill="#fff"/><text x="20" y="110" font-family="Helvetica" font-weight="700" font-size="96" fill="#14324A">NORTHLINE</text></svg>`, 600, 160)).toString("base64");
const responses = async (name: string, text: string, images: string[], extra: Record<string, unknown> = {}) => {
  const t0 = t();
  const res = await fetch(`${base}/responses`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: [{ role: "user", content: [...images.map((b) => ({ type: "input_image", image_url: `data:image/png;base64,${b}` })), { type: "input_text", text }] }], ...extra }) });
  const j = (await res.json().catch(() => ({}))) as { output?: { type: string; result?: string }[]; error?: { message?: string } };
  const img = j.output?.find((x) => x.type === "image_generation_call" && x.result)?.result;
  const got = img ? await save(name, img) : "";
  console.log(`  ${name.padEnd(26)} HTTP ${res.status} ${got ? `→ ${got}` : (j.error?.message ?? JSON.stringify(j).slice(0, 160))} (${((t() - t0) / 1000).toFixed(0)} s)`);
  return img;
};

console.log("\n■ References (/responses)");
await responses("edit-1ref", "@Image1 is a rain jacket. Place it on a hook by a rainy window, photoreal. No text.", [product]);
await responses("edit-2refs", "@Image1 is a rain jacket, @Image2 is the brand logo. Make a photoreal ad: the jacket on a model on a rainy street; put the logo from @Image2 small in the top-left corner exactly as given.", [product, logo]);
// What Keel actually uses: the shape stated in the prompt, checked, with a canvas retry.
const { museImage, imageSize } = await import("@keel/meta");
for (const aspect of ["4:5", "9:16"] as const) {
  const t0 = t();
  try {
    const b = await museImage({ prompt: "@Image1 is a rain jacket. Show it worn by a commuter on a rainy street, photoreal. No text.", references: [{ dataUrl: `data:image/png;base64,${product}` }], aspect });
    await writeFile(join(out, `keel-${aspect.replace(":", "x")}.webp`), b);
    const sz = imageSize(b);
    console.log(`  keel museImage ${aspect.padEnd(12)} → ${sz ? `${sz.w}x${sz.h}` : "?"} (${((t() - t0) / 1000).toFixed(0)} s)`);
  } catch (err) { console.log(`  keel museImage ${aspect}: ${(err as Error).message.slice(0, 160)}`); }
}

console.log("\n■ Text in the image");
const headline = "Built for the downpour";
const ad = await responses("text-ad", `@Image1 is the real rain jacket; keep it exactly. Design a finished Instagram ad, vertical 4:5: the jacket on a commuter at a rainy bus stop, cinematic. Headline exactly "${headline}" in a bold sans-serif at the top, and a small rounded button "Shop now". No other text.`, [product]);
if (ad) {
  const read = await callJson({ client: metaClient(), model: config.models.spark, system: "Read all text in the image exactly as written.", schema: z.object({ texts: z.array(z.string()).catch([]) }), text: 'JSON: {"texts": [string]}', images: [{ dataUrl: `data:image/webp;base64,${ad}` }] }).catch((e: Error) => ({ texts: [`(Spark failed: ${e.message})`] }));
  console.log(`  Spark reads: ${JSON.stringify(read.texts)} · headline exact: ${read.texts.some((x) => x.trim().toLowerCase() === headline.toLowerCase())}`);
}
console.log(`\nImages saved in ${out}`);
process.exit(0);
