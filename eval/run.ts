import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AdSnapshot, Variant } from "@keel/core";
import { loadImage, makeInspect, makeScreen } from "@keel/agents";
import { MetaSamSegmenter } from "@keel/meta";

interface Case { id: string; variant: string; label: "ok" | "defect"; codes: string[] }

const full = process.argv.includes("--full");
const threshold = Number(process.env.SCREEN_THRESHOLD ?? 0.35);
const file = process.argv.find((a) => a.endsWith(".jsonl")) ?? "eval/cases.jsonl";
const cases: Case[] = (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));

const screen = makeScreen(loadImage);
const inspect = makeInspect(loadImage, new MetaSamSegmenter());
let tp = 0, fp = 0, fn = 0, tn = 0;
const started = Date.now();

for (const c of cases) {
  const dir = join("eval/fixtures", c.id);
  const snap: AdSnapshot = { adId: c.id, adName: c.id, status: "ACTIVE", creativeId: c.id, originalImageRef: `file://${join(dir, "original.png")}`, featuresSpec: {}, variants: [] };
  const v: Variant = { id: `${c.id}:${c.variant}`, adId: c.id, placement: "fixture", imageRef: `file://${join(dir, c.variant)}`, source: "fixture" };
  const s = await screen(snap, v);
  let flagged = s.score >= threshold;
  if (full && flagged) flagged = (await inspect(snap, v, s)).some((f) => f.confidence >= 0.6);
  const truth = c.label === "defect";
  if (flagged && truth) tp++; else if (flagged && !truth) fp++; else if (!flagged && truth) fn++; else tn++;
  console.log(`${c.id.padEnd(24)} truth=${c.label.padEnd(6)} flagged=${flagged} score=${s.score.toFixed(2)} ${s.suspected.join(",")}`);
}

const precision = tp / Math.max(1, tp + fp);
const recall = tp / Math.max(1, tp + fn);
console.log(`\n${full ? "screen+inspect" : "screen"}: precision ${(precision * 100).toFixed(1)}%  recall ${(recall * 100).toFixed(1)}%  ` +
  `(tp ${tp} fp ${fp} fn ${fn} tn ${tn})  avg ${((Date.now() - started) / cases.length).toFixed(0)} ms/case`);
