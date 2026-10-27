# Keel — Product Ideation

> **Keel keeps your brand steady while Meta's AI steers your ads.**

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026), Indie Developer track, theme **Build for Your World**.

---

## 1. The problem

Meta's ad platform is moving to full automation. Advantage+ creative enhancements rewrite, crop, animate, re-score and re-voice live ads — and many of them are on by default.

What brands have reported publicly:

| Incident | What Meta's AI did | Cost to the brand |
|---|---|---|
| True Classic (men's apparel, targets men 30–45) | Replaced the top ad's model with an AI-generated elderly woman | Ran for days until customers flagged it |
| Kirruna (footwear) | Generated a model with a leg twisted backwards | Refunds when products didn't match the ad |
| Lectric (e-bikes) | Paired an e-bike question with a car flying through clouds | Off-brand, confusing creative |
| Restaurant chain (Scotiabank note) | Ad for chicken pot pie and pot roast advertised marijuana | Brand-safety incident |

Three structural facts make this a product, not a complaint:

1. **Settings drift.** Agencies report enhancements switching back on after they disable them. One agency managing ~$100M/yr in Meta spend blocks out several mornings a week to re-check toggles by hand.
2. **Review doesn't scale.** Meta says reviewing AI output is the advertiser's job, but each variant preview has to be opened one by one.
3. **Trust is costing Meta money.** Scotiabank reported that 25% of one expert's advertising clients were pulling back or leaving Meta, citing broken AI tooling.

**Keel's position:** not anti-automation. Keel is the guardrail that lets a brand say *yes* to Advantage+.

## 2. Who it's for

| Segment | Pain | Why they pay |
|---|---|---|
| D2C brands spending ₹5L+/month on Meta (Indian fashion, beauty, food) | One bad variant = refunds, comments, brand damage | Insurance on the biggest marketing channel |
| Performance agencies (10–30 accounts per manager) | Hours of manual toggle and preview checks per week | Replaces a junior's QA time across every client |
| In-house growth teams at larger brands | Legal/brand sign-off on every creative | Audit trail of what ran and who approved it |

Every finding lands in **Keel Bridge**, Keel's own web app, built for fast review: a queue sorted by severity, a side-by-side compare viewer, keyboard shortcuts for agencies, and push alerts to the phone. A WhatsApp channel for Indian founders is a later addition.

## 3. Product: one loop, five capabilities

Keel is an **autonomous agent that runs a watch → judge → act loop** on every connected ad account. Image analysis is one step inside that loop, not the product.

```
 Watch ──▶ Detect drift ──▶ Screen variants ──▶ Investigate ──▶ Decide ──▶ Ask human ──▶ Act ──▶ Verify ──▶ Learn
   ▲                                                                                                       │
   └───────────────────────────────────────────── every N hours ───────────────────────────────────────────┘
```

| Capability | What it does | Meta tooling |
|---|---|---|
| **Watch** | Pulls every live ad, its creative, its enhancement settings and rendered variant previews | Marketing API, Ads MCP |
| **Lock** | Snapshots each creative's enhancement settings; flags any change the brand didn't approve | Marketing API (`creative_features_spec`) |
| **Judge** | Two-tier review of every served variant against the approved original and the brand rulebook | Muse Spark Open / Glimmer (screen), SAM 3.1 (regions), Muse Spark (compare), Muse Wonder (investigate) |
| **Act** | Pause, revert to an un-enhanced creative, or replace with an on-brand variant — only after a decision in Keel Bridge | Marketing API, Muse Image |
| **Shield** | Pre-launch check of new creatives against Meta ad policy and brand rules | Muse Spark, Muse Wonder |

### Defect taxonomy (what "off-brand" means, concretely)

| Code | Defect | Example |
|---|---|---|
| `PERSON_MISMATCH` | People don't match the brand's stated audience/casting | Grandma replaces 30-something model |
| `ANATOMY` | Distorted bodies, hands, faces | Twisted leg |
| `PRODUCT_DRIFT` | Product colour, material, shape or count changed | Leather shoe rendered as suede |
| `TEXT_ERROR` | Misspelt, garbled or altered in-image text | Wrong price, broken words |
| `CLAIM` | Copy or voiceover makes a claim the brand never made | "50% off" that doesn't exist |
| `SCENE_MISMATCH` | Generated background/scene contradicts the message | Car in clouds for an e-bike |
| `BRAND_RULE` | Violates an explicit rule in the rulebook | Banned colour, alcohol shown, logo misuse |
| `POLICY_RISK` | Likely to trigger Meta ad-policy rejection | Before/after body imagery |
| `SETTING_DRIFT` | Enhancement toggled without approval | `image_background_gen` flipped to opt-in |

### The brand rulebook

Onboarding takes ~2 minutes: connect the ad account, pick 3–10 best past ads, optionally upload a brand-guidelines PDF and point at the product catalog. Muse Wonder drafts a structured rulebook (audience and casting, palette, tone, banned content, claim limits, product truths). The owner edits it. Every approve/reject tap is fed back so the rulebook sharpens over time.

### Human in the loop, always

Nothing that changes a live ad or spend happens without an explicit decision in Keel Bridge. The review card shows the approved original and what Meta served under a draggable waterline, outlines of the changed regions, the reasons and three choices: **approve the proposed action**, **make an on-brand replacement**, or **leave it running**. Owners can approve anything; reviewers can revert and reject; viewers watch. A push alert brings the owner to the card from their phone.

## 4. Why this wins on the rubric

| Criterion (weight) | How Keel scores |
|---|---|
| Impact (30%) | Documented, quantified pain at real brands; a buyer who already spends money on Meta; directly fixes a trust problem Meta itself has |
| Use of Meta AI tooling (25%) | Eight Meta tools: Facebook Login for Business, Ads MCP + Marketing API, Muse Spark Open/Glimmer, SAM 3.1, Muse Spark, Muse Wonder, Muse Image, Muse Voice Transcribe — plus Muse Code to build it |
| Demo (25%) | A visible "catch" moment, a push alert on the phone, a live trace, a one-tap fix that changes the live ad |
| Technical depth (20%) | Deterministic agent spine with model judgment at the edges, approval interrupts, hash-chained audit log, measured precision/recall on a labelled eval set, cost per variant by tier |

Bonus prizes in reach: **Best Build on Open-Weight Models** (screening tier on Muse Spark Open/Glimmer), **Best Agentic Use-Case**, **Most Viral** (the "caught Meta's AI" clip), **Community Vote**.

### Guardrails against disqualification

- **Not a "simple image analyzer"** (on the anti-project list): every demo beat leads with the agent loop — watching, drift, decision, approval, action, verification.
- **New work only:** fresh repo, dated commits from Oct 27, no code reused from earlier projects. README lists exactly what was built.
- **Public repo** before submission.

## 5. MVP scope (must ship) vs stretch

| Priority | Feature |
|---|---|
| P0 | Connect one ad account (system-user token); ingest ads, creatives, enhancement settings |
| P0 | Settings snapshot + drift detection + audit log |
| P0 | Variant source: Meta previews **or** fixture variants (fallback, see risks) |
| P0 | Two-tier judge: open-weight screen → SAM 3.1 regions → Muse Spark comparison → structured findings |
| P0 | Brand rulebook drafted by Muse Wonder from sample ads |
| P0 | Keel Bridge review queue: compare viewer, decision → approval interrupt → Marketing API action → verify |
| P0 | Live trace view and push alerts |
| P0 | Eval set (40 labelled pairs) + precision/recall report |
| P1 | Muse Image on-brand replacement with second approval |
| P1 | Lock board, audit timeline, onboarding with rulebook drafting |
| P1 | Investigator sub-agent (Muse Wonder + tools) for ambiguous cases |
| P2 | Shield pre-launch check |
| P2 | Video ads: SAM 3.1 tracking across frames, voiceover transcription + claim check |
| P2 | Voice command bar (Muse Voice Transcribe from the browser mic) |

**Cut order if behind:** P2 → investigator → replacement → dashboard polish. Watch, Lock, Judge, Act are the product.

## 6. Biggest risks and fallbacks

| Risk | Likelihood | Fallback |
|---|---|---|
| Marketing API doesn't expose rendered previews of AI-enhanced variants | Medium | `FixtureVariantSource`: brand uploads exports / we generate realistic "bad" variants with Muse Image on a test account; drift + act still run on the real API. Ask Meta in #office-hours on day 1. |
| `creative_features_spec` is read-only on the features endpoint; creatives may be immutable | High | "Revert" = create a new creative with enhancements `OPT_OUT`, then point the ad at it. Already in the design. |
| SAM 3.1 API shape (Responses API, streamed markers) differs from expectations | Medium | `Segmenter` interface; fallback to whole-image comparison with Muse Spark bounding boxes |
| Facebook Login for Business needs app review for public use | Known | Development mode covers you and test users through the hackathon; judges use the demo workspace |
| Muse Voice Transcribe is realtime-only (WebSocket, PCM16) | Known | Stream the browser mic directly in push-to-talk mode |
| Model latency/cost across hundreds of variants | Medium | Open-weight screen first; only suspicious variants go to Spark/Wonder; cache by image hash |

## 7. Demo script (3 minutes)

1. **0:00 Hook (15s).** Real headline of the grandma-swap incident. "Meta says reviewing its AI is your job. Keel does it for you."
2. **0:15 Onboard (30s).** OAuth/system-user connect, upload 3 past ads; Muse Wonder drafts the rulebook on screen.
3. **0:45 The catch (60s).** Keel's cycle runs. A served variant has swapped the model and shifted the shoe colour. Side-by-side card, SAM masks highlighting the changed regions, the open-weight screen score, Muse Spark's reasons.
4. **1:45 The drift (20s).** Flip `image_background_gen` on in Ads Manager. Next cycle flags it and logs who/what/when.
5. **2:05 The fix (40s).** Phone shows a Keel push alert; tapping it opens the review card. Drag the waterline, toggle the outlines, press **P** → Muse Image variant → approve → the live trace shows the swap and the read-back from Meta.
6. **2:45 The number (15s).** "[N] variants audited in [T] seconds, [P]% precision on our eval set, [cost] per variant on the open-weight tier" — real numbers from `npm run eval`, never placeholders in the final video. Close on the positive pitch.

Every frame labelled with what was built during the hackathon.

## 8. Build plan (IST)

| Day | Date | Goal |
|---|---|---|
| 1 | Tue Oct 27 | Repo, docs, credits; Keel Bridge scaffold; API access spike (Model API, Marketing API, previews, features spec, Facebook Login app). Ask preview question in office hours (7:30 PM). Agents 101 at 9:30 PM. |
| 2 | Wed Oct 28 | `packages/meta` against live APIs. Ingest + snapshot + drift. Agents 102 (verifiable agents) at 9:30 PM. |
| 3 | Thu Oct 29 | Variant sources (Meta previews + fixtures). Build the 40-pair labelled eval set. |
| 4 | Fri Oct 30 | Judge pipeline: open-weight screen, SAM 3.1 regions, Muse Spark comparison, findings schema. Eval runner v1. Fireworks session 9:30 PM. |
| 5 | Sat Oct 31 | Rulebook drafting with Muse Wonder + feedback loop. Tune prompts against eval. |
| 6 | Sun Nov 1 | LangGraph wiring: decide → approval interrupt → act → verify; audit log. |
| 7 | Mon Nov 2 | Review flow end to end on a real cycle; push alerts; Muse Image replacement. |
| 8 | Tue Nov 3 | Keel Bridge polish; investigator sub-agent; deploy (API + worker + web). |
| 9 | Wed Nov 4 | Final eval numbers, README, record demo, X post. Office hours now 8:30 PM IST. |
| — | Thu Nov 5, 7:30 AM | **Submission deadline** |

## 9. Business model (for the impact story)

- D2C: ₹4,999 / ad account / month (~$60).
- Agencies: per-account tier with volume pricing.
- Later: outcome pricing per incident caught or refunds avoided.

## Sources

- [Meta Advantage+ forcing AI creative on brands — Shopifreaks](https://www.shopifreaks.com/meta-advantage-is-forcing-unwanted-ai-creative-on-brands/)
- [Meta's AI ads go awry — HyperAI](https://hyper.ai/en/stories/56faf70cd6e22a1484a8b076a832fa16)
- [Scotiabank note on Meta advertisers — InvestingLive](https://investinglive.com:443/stocks/meta-advertisers-are-reducing-spending-and-their-ai-ad-rollout-has-been-flawed-scotia-20260407/)
- [Meta AI ad tools auto-enrollment audit — Common Thread Co](https://commonthreadco.com/blogs/coachs-corner/meta-ai-ad-tools-auto-enrollment-audit-2026)
- [Official Meta Ads MCP: 29 tools — Pasquale Pillitteri](https://pasqualepillitteri.it/en/news/1707/official-meta-ads-mcp-claude-29-tools-2026)
- [Ad Creative Features Spec — Meta for Developers](https://developers.facebook.com/docs/marketing-api/reference/ad-creative-features-spec/)
- [Meta Global AI Developer Hackathon participant guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details)
