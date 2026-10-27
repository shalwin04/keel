/**
 * The demo workspace, so Keel Bridge has something to show before a real ad account is connected:
 * a fictional brand, four ads, a drifted setting, three findings awaiting review, a full cycle trace
 * and a hash-chained audit trail. Safe to re-run (it replaces the demo rows).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { asc, eq, inArray } from "drizzle-orm";
import { GENESIS, chain } from "./audit.ts";
import type { Db } from "./client.ts";
import * as schema from "./schema.ts";

const MEDIA = fileURLToPath(new URL("../../../.data/media/demo", import.meta.url));
export const DEMO_WORKSPACE_ID = "ws_demo";
const WS = DEMO_WORKSPACE_ID, OWNER = "user_demo_owner", BRAND = "brand_demo_northline", ACCOUNT = "act_demo_001";
const CYCLE = "cycle_demo_001";

// ── Illustrative ad images (fictional brand) ─────────────────────────────────
const frame = (bg: string, body: string, caption: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
<rect width="600" height="600" fill="${bg}"/>${body}
<rect x="0" y="500" width="600" height="100" fill="#14324A"/>
<text x="40" y="560" font-family="Helvetica, Arial" font-size="34" fill="#EEF2F1" font-weight="700">${caption}</text></svg>`;
const person = (x: number, skin: string, top: string, hair: string, legs = "") => `
<circle cx="${x}" cy="150" r="48" fill="${skin}"/><path d="M${x - 50} 110 q50 -60 100 0" fill="${hair}"/>
<rect x="${x - 70}" y="205" width="140" height="170" rx="30" fill="${top}"/>
${legs || `<rect x="${x - 55}" y="370" width="45" height="130" fill="${top}"/><rect x="${x + 10}" y="370" width="45" height="130" fill="${top}"/>`}`;

const IMAGES: Record<string, string> = {
  "fleece-original.svg": frame("#DCE6EA", person(300, "#C68A5E", "#3E5A6E", "#2A1C14"), "Northline fleece set · ₹2,499"),
  "fleece-served.svg": frame("#F1D9C4", person(300, "#E8C4A8", "#3E5A6E", "#D8D8D8") + `<rect x="200" y="420" width="200" height="60" rx="10" fill="#8A6B4E"/>`, "Northline fleece set · ₹2,499"),
  "runner-original.svg": frame("#E4ECE4", `<path d="M120 380 q60 -90 200 -60 l140 20 q40 10 30 50 l-370 0z" fill="#14324A"/><rect x="120" y="390" width="370" height="25" rx="8" fill="#EEF2F1"/>`, "Trail runner · Leather"),
  "runner-served.svg": frame("#E4ECE4", `<path d="M120 380 q60 -90 200 -60 l140 20 q40 10 30 50 l-370 0z" fill="#B88A5A"/><rect x="120" y="390" width="370" height="25" rx="8" fill="#EEF2F1"/><path d="M150 360 l300 -30" stroke="#9C7448" stroke-width="6" stroke-dasharray="4 8"/>`, "Trail runner · Leather"),
  "jacket-original.svg": frame("#DDE3EC", person(300, "#8D5A3B", "#B8862B", "#1A1210"), "Monsoon jacket · 20% off"),
  "jacket-served.svg": frame("#DDE3EC", person(300, "#8D5A3B", "#B8862B", "#1A1210", `<rect x="245" y="370" width="45" height="130" fill="#B8862B"/><rect x="310" y="370" width="45" height="80" fill="#B8862B" transform="rotate(140 332 410)"/>`), "Monsoon jacket · 50% off"),
};

export async function seedDemo(db: Db, mediaDir = MEDIA) {
  const ref = (f: string) => `file://${join(mediaDir, f)}`;
  await mkdir(mediaDir, { recursive: true });
  for (const [f, svg] of Object.entries(IMAGES)) await writeFile(join(mediaDir, f), svg);


  // Clear previous demo rows (children first).
  const oldProposals = await db.select({ id: schema.proposals.id }).from(schema.proposals).where(eq(schema.proposals.accountId, ACCOUNT));
  if (oldProposals.length) await db.delete(schema.approvals).where(inArray(schema.approvals.proposalId, oldProposals.map((p) => p.id)));
  await db.delete(schema.proposals).where(eq(schema.proposals.accountId, ACCOUNT));
  await db.delete(schema.findings).where(eq(schema.findings.accountId, ACCOUNT));
  await db.delete(schema.snapshots).where(eq(schema.snapshots.accountId, ACCOUNT));
  await db.delete(schema.traceEvents).where(eq(schema.traceEvents.cycleId, CYCLE));
  await db.delete(schema.cycles).where(eq(schema.cycles.accountId, ACCOUNT));
  await db.delete(schema.creativeBaselines).where(inArray(schema.creativeBaselines.adId, ["ad_fleece", "ad_runner", "ad_jacket", "ad_tee"]));

  await db.insert(schema.workspaces).values({ id: WS, name: "Northline (demo)", isDemo: true }).onConflictDoNothing();
  await db.insert(schema.users).values({ id: OWNER, name: "Demo owner" }).onConflictDoNothing();
  await db.insert(schema.memberships).values({ workspaceId: WS, userId: OWNER, role: "owner" }).onConflictDoNothing();
  await db.insert(schema.brands).values({ id: BRAND, workspaceId: WS, name: "Northline Apparel", policy: {} }).onConflictDoNothing();
  await db.insert(schema.adAccounts).values({ id: "acct_demo_001", brandId: BRAND, metaAccountId: ACCOUNT, name: "Northline Apparel ads" }).onConflictDoNothing();

  const started = new Date(Date.now() - 18 * 60_000);
  await db.insert(schema.cycles).values({ id: CYCLE, accountId: ACCOUNT, status: "awaiting_approval", startedAt: started });

  const off = "OPT_OUT", on = "OPT_IN";
  const spec = (o: Record<string, string>) => ({ image_touchups: off, image_background_gen: off, text_optimizations: on, music_generation: off, image_animation: off, ...o });
  const ads = [
    { adId: "ad_fleece", adName: "Fleece set hero", creativeId: "cr_fleece", originalRef: ref("fleece-original.svg"), now: spec({ image_background_gen: on }), baseline: spec({}) },
    { adId: "ad_runner", adName: "Trail runner launch", creativeId: "cr_runner", originalRef: ref("runner-original.svg"), now: spec({ image_touchups: on }), baseline: spec({ image_touchups: on }) },
    { adId: "ad_jacket", adName: "Monsoon jacket sale", creativeId: "cr_jacket", originalRef: ref("jacket-original.svg"), now: spec({ text_optimizations: on, music_generation: on }), baseline: spec({}) },
    { adId: "ad_tee", adName: "Everyday tee", creativeId: "cr_tee", originalRef: null, now: spec({}), baseline: spec({}) },
  ];
  await db.insert(schema.snapshots).values(ads.map((a) => ({
    id: `snap_${a.adId}`, cycleId: CYCLE, accountId: ACCOUNT, adId: a.adId, adName: a.adName, status: "ACTIVE", creativeId: a.creativeId,
    originalRef: a.originalRef, featuresSpec: a.now, variants: [], takenAt: started,
  })));
  await db.insert(schema.creativeBaselines).values(ads.map((a) => ({ creativeId: a.creativeId, adId: a.adId, featuresSpec: a.baseline, lockedBy: OWNER })));

  const findings = [
    { id: "f_fleece_person", adId: "ad_fleece", code: "PERSON_MISMATCH", severity: "high", confidence: 0.91,
      summary: "Meta swapped your model for an older woman", evidence: ["Person region: different age and hair from the approved model", "Rulebook casting: men 25–40"],
      regions: [{ label: "person", box: [0.33, 0.13, 0.67, 0.84] }], originalRef: ref("fleece-original.svg"), variantRef: ref("fleece-served.svg") },
    { id: "f_fleece_drift", adId: "ad_fleece", code: "SETTING_DRIFT", severity: "medium", confidence: 1,
      summary: "image_background_gen is OPT_IN (approved: OPT_OUT)", evidence: ["creative_features_spec.image_background_gen"], regions: [], originalRef: null, variantRef: null },
    { id: "f_runner_product", adId: "ad_runner", code: "PRODUCT_DRIFT", severity: "critical", confidence: 0.88,
      summary: "The leather shoe now looks like brown suede", evidence: ["Product region: colour shifted from navy to tan", "Catalog says: full-grain leather, navy"],
      regions: [{ label: "product", box: [0.18, 0.5, 0.86, 0.7] }], originalRef: ref("runner-original.svg"), variantRef: ref("runner-served.svg") },
    { id: "f_jacket_claim", adId: "ad_jacket", code: "CLAIM", severity: "critical", confidence: 0.95,
      summary: "Ad now says 50% off; your sale is 20% off", evidence: ["Headline text region: \"50% off\"", "Rulebook claim limit: discounts as approved only"],
      regions: [{ label: "headline text", box: [0.05, 0.86, 0.95, 0.98] }], originalRef: ref("jacket-original.svg"), variantRef: ref("jacket-served.svg") },
    { id: "f_jacket_anatomy", adId: "ad_jacket", code: "ANATOMY", severity: "critical", confidence: 0.83,
      summary: "Model's right leg is bent backwards", evidence: ["Leg region: knee angle impossible"], regions: [{ label: "leg", box: [0.5, 0.6, 0.66, 0.84] }],
      originalRef: ref("jacket-original.svg"), variantRef: ref("jacket-served.svg") },
  ] as const;
  await db.insert(schema.findings).values(findings.map((f) => ({
    ...f, evidence: [...f.evidence], regions: f.regions.map((r) => ({ ...r, box: [...r.box] })), cycleId: CYCLE, accountId: ACCOUNT,
    variantId: f.variantRef ? `${f.adId}:feed` : null, detectedBy: f.code === "SETTING_DRIFT" ? "drift" : "inspect", createdAt: started,
  })));

  const expires = new Date(Date.now() + 5.5 * 3_600_000);
  const proposals = [
    { id: "p_fleece", adId: "ad_fleece", findingIds: ["f_fleece_person", "f_fleece_drift"], action: "REVERT_CREATIVE", reason: "PERSON_MISMATCH and SETTING_DRIFT" },
    { id: "p_runner", adId: "ad_runner", findingIds: ["f_runner_product"], action: "PAUSE_AD", reason: "PRODUCT_DRIFT" },
    { id: "p_jacket", adId: "ad_jacket", findingIds: ["f_jacket_claim", "f_jacket_anatomy"], action: "PAUSE_AD", reason: "CLAIM and ANATOMY" },
  ];
  await db.insert(schema.proposals).values(proposals.map((p) => ({ ...p, cycleId: CYCLE, accountId: ACCOUNT, requiresApproval: true, status: "pending", expiresAt: expires })));

  // A full trace for the cycle, up to the approval pause.
  let t = started.getTime();
  const ev = (kind: string, node: string | null, data: Record<string, unknown> = {}, gap = 400) =>
    ({ cycleId: CYCLE, kind, node, at: new Date((t += gap)), data });
  const trace = [
    ev("cycle_start", "ingest", { accountId: ACCOUNT }),
    ev("node_start", "ingest"), ev("node_end", "ingest", { ms: 2140, ads: 4 }, 2140),
    ev("node_start", "detectDrift"), ev("node_end", "detectDrift", { ms: 38, findings: 2 }, 38),
    ev("node_start", "screen"),
    ...Array.from({ length: 12 }, (_, i) => ev("model_call", "screen", { tier: "screen", model: "meta-models/muse-spark-open-1026", ms: 380 + ((i * 97) % 300) }, 120)),
    ev("node_end", "screen", { ms: 1890, variants: 12, flagged: 3 }, 200),
    ev("node_start", "inspect"),
    ...["segment", "inspect", "segment", "inspect", "segment", "inspect"].map((tier, i) =>
      ev("model_call", "inspect", tier === "segment" ? { tier, model: "sam-3.1", ms: 640 + i * 20 } : { tier, model: "muse-spark-1.3", ms: 2900 + i * 150, costUsd: 0.0041 }, 700)),
    ev("node_end", "inspect", { ms: 9800, findings: 4 }, 300),
    ev("node_start", "investigate"), ev("node_end", "investigate", { ms: 12 }, 12),
    ev("node_start", "decide"), ev("node_end", "decide", { ms: 21, proposals: 3 }, 21),
    ev("node_start", "notify"), ev("node_end", "notify", { ms: 310 }, 310),
    ev("node_start", "requestApproval"), ev("node_end", "requestApproval", { ms: 4, paused: true }, 4),
  ];
  await db.insert(schema.traceEvents).values(trace);

  // Audit trail, chained onto whatever is already there.
  const existing = await db.select({ hash: schema.auditLog.hash }).from(schema.auditLog).orderBy(asc(schema.auditLog.seq));
  let prev = existing.at(-1)?.hash ?? GENESIS;
  for (const [actor, event, payload] of [
    [OWNER, "account.connected", { metaAccountId: ACCOUNT }],
    ["keel", "cycle.ingested", { cycleId: CYCLE, ads: 4 }],
    ["keel", "cycle.decided", { cycleId: CYCLE, proposals: proposals.map((p) => [p.adId, p.action]) }],
  ] as const) {
    const e = chain(prev, actor, event, payload);
    await db.insert(schema.auditLog).values({ actor, event, payload: payload as object, prevHash: e.prevHash, hash: e.hash });
    prev = e.hash;
  }

  return { ads: ads.length, findings: findings.length, proposals: proposals.length };
}
