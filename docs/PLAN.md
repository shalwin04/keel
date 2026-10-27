# Keel — Build Plan

**Deadline: Thu Nov 5, 7:30 AM IST** (Wed Nov 4, 9:00 PM ET). Submission needs a public repo, a 3-minute demo video and a live product.

Status as of **Tue Oct 27, 12:30 PM IST** (day 1 of 9).

## Where we are

| Area | Status | Notes |
|---|---|---|
| Product spec, architecture | Done | `docs/IDEATION.md`, `docs/ARCHITECTURE.md` |
| Monorepo, tooling | Done | npm workspaces, TypeScript 7, Vitest, Drizzle, Vite |
| Decision policy | Done | Pure `decide()`, tested |
| Drift detection | Done | `diffFeatures()`, tested |
| Watch cycle graph | Done (skeleton) | Approval pause and resume tested with fakes |
| Hash-chained audit log | Done | Chain + verify, tested; written to Postgres |
| Approval tokens | Done | Signed, single-use button ids, tested |
| DB schema + migration | Done | 9 tables, first migration generated |
| Model API, open-weight clients | Code written, untested live | Model IDs unconfirmed |
| SAM 3.1 segmenter | Stub | Output parser returns nothing yet |
| Marketing API client | Code written, untested live | List, read creative, features spec, previews, pause, create, swap |
| Ads MCP client | Code written, untested live | Anomaly-signal tool arguments unconfirmed |
| WhatsApp send + webhook | Code written, untested live | Card image not built |
| Variant sources | Partial | Fixtures work; Meta previews return HTML, not yet images |
| Actions | Partial | Pause only; relock, revert, replace not built; no verify step |
| Rulebook drafting (Muse Wonder) | Not started | Prompt exists |
| Investigator sub-agent | Not started | |
| Muse Image replacement | Not started | |
| Voice notes (Muse Voice Transcribe) | Not started | |
| Eval set | Not started | Runner and case format exist; no fixtures |
| Dashboard | Skeleton | Findings list only |
| Deploy | Not started | |
| Public GitHub repo | Not started | No remote yet |

## Milestones

Each milestone has a "done when" test. Dates are targets; cut scope, not the deadline.

### M0 · Access spike — Tue Oct 27

- [ ] Push to a public GitHub repo
- [ ] Claim $150 Meta Model API credits; request Baseten and Modal credits
- [ ] Meta Model API: one Muse Spark call with an image; confirm model IDs for Spark, Wonder, Image, SAM
- [ ] SAM 3.1: one call, save the raw response to `docs/notes/sam-response.json`
- [ ] Baseten: one `meta-models/muse-spark-open-1026` call with an image
- [ ] Marketing API: system-user token on a test ad account; list ads; read `degrees_of_freedom_spec`
- [ ] Ask in #office-hours (7:30 PM IST): do ad previews render AI-enhanced variants?
- [ ] WhatsApp Cloud API test number: send one interactive button message, receive the reply webhook (ngrok)
- [ ] Watch Agents 101 (9:30 PM IST)

**Done when:** every external API has answered one real request, and `.env.example` holds confirmed model IDs.

### M1 · Real ingest and drift — Wed Oct 28

- [ ] `snapshotAccount` against the test account, saved to `snapshots`
- [ ] Baseline locking: `creative_baselines` written on first sight or on owner approval
- [ ] Drift found by flipping an enhancement in Ads Manager
- [ ] Watch Agents 102 (9:30 PM IST); fold its "verifiable agents" advice into `act`/`verify`

**Done when:** `npm run cycle:once` produces a `SETTING_DRIFT` finding from a real toggle.

### M2 · Variants and the eval set — Thu Oct 29

- [ ] Decide variant source from the office-hours answer
- [ ] If previews work: render preview HTML to PNG with Playwright
- [ ] Build 40 labelled pairs: ~25 defects covering every code, ~15 acceptable variants (Muse Image edits reproducing reported failures; clean crops)
- [ ] `eval/cases.jsonl` committed (no brand assets you don't own)

**Done when:** `npm run eval` runs end to end on 40 cases.

### M3 · Judges for real — Fri Oct 30

- [ ] Parse SAM 3.1 output into regions; draw masks for the card
- [ ] Tune screen prompt and threshold on the eval set (target recall ≥ 90%)
- [ ] Tune inspect prompt (target precision ≥ 85%)
- [ ] Record cost and latency per variant for each tier
- [ ] Fireworks session (9:30 PM IST) for open-weight tips

**Done when:** eval report shows precision, recall and cost per tier, saved to `eval_runs`.

### M4 · Brand rulebook — Sat Oct 31

- [ ] Muse Wonder drafts a rulebook from 3–10 past ads (+ optional guidelines PDF)
- [ ] Owner edits it (dashboard form or JSON)
- [ ] Approve/reject outcomes fed back as rulebook notes
- [ ] Re-run eval with the rulebook; compare

**Done when:** a rulebook changes at least one eval verdict for the better.

### M5 · Actions and verification — Sun Nov 1

- [ ] `RELOCK_SETTING` and `REVERT_CREATIVE`: new creative with enhancements opted out, swap, re-read
- [ ] `verify` step: re-read ad state; alert on mismatch
- [ ] Expiry: proposals expire after 6 h and are logged
- [ ] Investigator sub-agent (Muse Wonder + tools, 8-step cap) for ambiguous findings

**Done when:** an approved revert changes the live test ad and Keel confirms it.

### M6 · WhatsApp end to end — Mon Nov 2

- [ ] Side-by-side card image (original | served, masks drawn), hosted at `/cards/:id.png`
- [ ] Button tap resumes the right cycle; duplicate taps ignored
- [ ] `REPLACE_CREATIVE`: Muse Image variant → second approval → swap
- [ ] Stretch: voice-note approval via Muse Voice Transcribe (ffmpeg → PCM16)

**Done when:** phone buzzes, one tap fixes the live ad, audit log shows every step.

### M7 · Dashboard and deploy — Tue Nov 3

- [ ] Dashboard: accounts, findings feed, side-by-side viewer, audit log with chain check
- [ ] Deploy API + worker (Cloud Run or Railway), web (Vercel), Postgres (Neon)
- [ ] Live URL in README

**Done when:** a judge can open the live dashboard and see a real catch.

### M8 · Demo and submission — Wed Nov 4

- [ ] Final eval numbers into README and video
- [ ] Record the 3-minute demo (script in `docs/IDEATION.md` §7), each beat labelled as hackathon-built
- [ ] README "Built during the hackathon" table complete
- [ ] Repo public, video public, submit on the Cerebral Valley platform
- [ ] Post demo on X (Most Viral prize)

**Done when:** submitted before Thu Nov 5, 7:30 AM IST — aim for Wed Nov 4 evening.

## Cut order if behind

1. Voice notes
2. Shield pre-launch check
3. Video ads
4. Investigator sub-agent
5. Muse Image replacement
6. Dashboard polish

Never cut: watch, drift, two-tier judge, WhatsApp approval, one real action with verify, eval numbers.

## Open questions

| Question | Blocks | Ask where |
|---|---|---|
| Do Marketing API previews show AI-enhanced variants? | M2 variant source | #office-hours, Oct 27 |
| SAM 3.1 request and mask format | M3 | Docs + one test call |
| Does the Model API expose Muse Wonder's Active Memory? | M4 (or store memory ourselves) | Docs, #office-hours |
| Exact Muse Image model ID and edit endpoint | M6 replacement | Docs |
| Ads MCP auth for a headless worker | Insights in cycle | Docs; fall back to Marketing API |
