import type { Approval, FeaturesSpec, Finding, Proposal, Rulebook } from "@keel/core";
import { type AdsGraphClient, type ImageInput, featuresOf, generateImage, readMedia, saveMedia } from "@keel/meta";
import type { ActionContext, ActionResult } from "./deps.ts";
import { driftedFeature, isOn } from "./drift.ts";

export interface ActionEnv {
  ads: AdsGraphClient;
  accountId: string;
  /** Muse Image, injectable for tests. */
  generate?: (prompt: string, refs: ImageInput[]) => Promise<Buffer>;
  load?: (ref: string) => Promise<ImageInput>;
}

const optOutAll = (spec: FeaturesSpec): FeaturesSpec => Object.fromEntries(Object.keys(spec).map((k) => [k, "OPT_OUT"]));

/** What the approved action actually does to the ad. `replace` as a decision upgrades any action to a replacement. */
export function effectiveAction(p: Proposal, approval?: Approval) {
  return approval?.decision === "replace" ? "REPLACE_CREATIVE" : p.action;
}

export function replacementPrompt(findings: Finding[], rulebook?: Rulebook) {
  return [
    "Recreate this exact ad image faithfully: same product, same person, same composition, same text and logo.",
    "Fix only these problems that an automated variant introduced:",
    ...findings.map((f) => `- ${f.summary}`),
    rulebook?.palette.length ? `Brand palette: ${rulebook.palette.join(", ")}.` : "",
    rulebook?.tone ? `Tone: ${rulebook.tone}.` : "",
    rulebook?.banned.length ? `Never include: ${rulebook.banned.join("; ")}.` : "",
    "Do not add claims, prices or people that are not in the reference.",
  ].filter(Boolean).join("\n");
}

/**
 * Runs an approved proposal against the Marketing API. Every change is a new creative swapped into the ad
 * (creatives are immutable), so the previous creative id is kept in the result for undo and the audit log.
 */
export async function executeAction(env: ActionEnv, p: Proposal, approval: Approval | undefined, ctx: ActionContext): Promise<ActionResult> {
  const action = effectiveAction(p, approval);
  const { ads, accountId } = env;
  if (action === "LOG") return { ok: true, detail: "logged" };
  if (action === "PAUSE_AD") {
    await ads.pauseAd(p.adId);
    return { ok: true, detail: "ad paused", data: { action } };
  }

  const ad = await ads.getAd(p.adId);
  const source = await ads.getCreative(ad.creative.id);
  const current = featuresOf(source);

  if (action === "RELOCK_SETTING") {
    const names = new Set([
      ...ctx.findings.map(driftedFeature).filter((n): n is string => !!n),
      ...(ctx.rulebook?.lockedEnhancements ?? []).filter((n) => isOn(current[n])),
    ]);
    if (!names.size) return { ok: false, detail: "no drifted setting found on the finding" };
    const features = { ...current, ...Object.fromEntries([...names].map((n) => [n, "OPT_OUT"])) };
    const creativeId = await ads.cloneCreative(accountId, source, { features });
    await ads.swapCreative(p.adId, creativeId);
    return { ok: true, detail: `switched off ${[...names].join(", ")}`, data: { action, creativeId, previousCreativeId: source.id, features, optedOut: [...names] } };
  }

  if (action === "REVERT_CREATIVE") {
    const features = optOutAll(current);
    const creativeId = await ads.cloneCreative(accountId, source, { features });
    await ads.swapCreative(p.adId, creativeId);
    return { ok: true, detail: "approved creative restored with AI enhancements off", data: { action, creativeId, previousCreativeId: source.id, features, optedOut: Object.keys(features) } };
  }

  if (action === "REPLACE_CREATIVE") {
    const originalRef = ctx.snapshot?.originalImageRef;
    if (!originalRef) return { ok: false, detail: "no approved original image to work from" };
    const load = env.load ?? (async (ref: string) => {
      const m = await readMedia(ref);
      return { dataUrl: `data:${m.mime};base64,${m.bytes.toString("base64")}` };
    });
    const generate = env.generate ?? ((prompt: string, refs: ImageInput[]) => generateImage({ prompt, references: refs }));
    const bytes = await generate(replacementPrompt(ctx.findings, ctx.rulebook), [await load(originalRef)]);
    const imageRef = await saveMedia(bytes, ".png", "replacements");
    const imageHash = await ads.uploadImage(accountId, bytes);
    const features = optOutAll(current);
    const creativeId = await ads.cloneCreative(accountId, source, { features, imageHash });
    await ads.swapCreative(p.adId, creativeId);
    return { ok: true, detail: "on-brand replacement is live", data: { action, creativeId, previousCreativeId: source.id, features, optedOut: Object.keys(features), imageRef } };
  }
  return { ok: false, detail: `unknown action ${action}` };
}

/** Reads the ad back from Meta and checks the change actually landed. */
export async function verifyAction(env: ActionEnv, p: Proposal, executed: ActionResult): Promise<ActionResult> {
  const action = (executed.data?.action as string | undefined) ?? p.action;
  const ad = await env.ads.getAd(p.adId);
  if (action === "PAUSE_AD") {
    return ad.status === "PAUSED" ? { ok: true, detail: "Meta reports the ad as paused" } : { ok: false, detail: `ad status is ${ad.status}` };
  }
  const expected = executed.data?.creativeId as string | undefined;
  if (!expected) return { ok: true, detail: "nothing to verify" };
  if (ad.creative.id !== expected) return { ok: false, detail: `ad still serves creative ${ad.creative.id}` };
  const now = await env.ads.getFeaturesSpec(expected);
  const stillOn = ((executed.data?.optedOut as string[]) ?? []).filter((n) => isOn(now[n]));
  return stillOn.length
    ? { ok: false, detail: `still on: ${stillOn.join(", ")}` }
    : { ok: true, detail: "Meta serves the new creative with those enhancements off" };
}
