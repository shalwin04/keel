# Keel — Build Plan

**Deadline: Thu Nov 5, 7:30 AM IST** (Wed Nov 4, 9:00 PM ET). Submission needs a public repo, a 3-minute demo video and a live product.

Status as of **Tue Oct 27, 4:00 PM IST** (day 1 of 9). Approvals moved from WhatsApp to **Keel Bridge**, Keel's own web app.

## Where we are

| Area | Status | Notes |
|---|---|---|
| Product spec, architecture | Done | Updated for Keel Bridge |
| Monorepo, tooling | Done | npm workspaces, TypeScript 7, Vitest, Drizzle, Vite; local Postgres without Docker |
| Decision policy, roles | Done | `decide()` and `canDecide()`, tested |
| Drift detection | Done | Tested |
| Watch cycle graph | Done (skeleton) | 11 steps incl. notify and verify; pause/resume tested with fakes |
| Live trace | Done | Node and model-call events → Postgres NOTIFY → SSE → browser |
| Hash-chained audit log | Done | Verified on every audit page load |
| Keel Bridge screens | Done (first pass) | Review with compare viewer, live trace, accounts + lock board, audit, onboarding, sign-in |
| Auth | Done, untested live | Facebook Login for Business flow; sessions; Origin checks; dev and demo sign-in tested |
| Web push | Done, untested on a phone | Service worker, subscribe, send; needs VAPID keys |
| Demo workspace | Done | Seeded Northline brand; simulated decisions; reset |
| Model API, open-weight clients | Code written, untested live | Model IDs unconfirmed |
| SAM 3.1 segmenter | Stub | Output parser returns nothing yet |
| Marketing API client | Code written, untested live | |
| Variant sources | Partial | Fixtures work; Meta previews return HTML, not images |
| Actions | Partial | Pause + verify only; relock, revert, replace not built |
| Rulebook drafting | Code written, untested live | Muse Wonder call + onboarding screen |
| Investigator sub-agent | Not started | |
| Muse Image replacement | Not started | |
| Voice commands | Not started | Stretch |
| Eval set | Not started | Runner and format exist |
| Deploy | Not started | |
| Public GitHub repo | Not started | |

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
- [ ] Meta app with Facebook Login for Business (development mode); sign in to Keel Bridge with it
- [ ] Generate VAPID keys; install Keel Bridge on your phone; receive a test push
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

### M6 · Review flow end to end — Mon Nov 2

- [ ] A real cycle pauses, the card appears live in Keel Bridge, push arrives on the phone
- [ ] Approve from the phone → act → verify → trace shows the read-back
- [ ] `REPLACE_CREATIVE`: Muse Image variant shown in the card → second decision → swap
- [ ] Stretch: voice command bar (Muse Voice Transcribe from the browser mic)

**Done when:** phone alert, one tap fixes the live ad, audit log shows every step.

### M7 · Polish and deploy — Tue Nov 3

- [ ] Rulebook editor; show which rule triggered each finding
- [ ] Replacement studio (pick between Muse Image options)
- [ ] Deploy API + worker (Cloud Run or Railway), web (Vercel), Postgres (Neon); demo workspace seeded
- [ ] Live URL in README

**Done when:** a judge opens the live URL, enters the demo, and approves a finding.

### M8 · Demo and submission — Wed Nov 4

- [ ] Final eval numbers into README and video
- [ ] Record the 3-minute demo (script in `docs/IDEATION.md` §7), each beat labelled as hackathon-built
- [ ] README "Built during the hackathon" table complete
- [ ] Repo public, video public, submit on the Cerebral Valley platform
- [ ] Post demo on X (Most Viral prize)

**Done when:** submitted before Thu Nov 5, 7:30 AM IST — aim for Wed Nov 4 evening.

## Cut order if behind

1. Voice command bar
2. Shield pre-launch check
3. Video ads
4. Investigator sub-agent
5. Muse Image replacement
6. Rulebook editor and replacement studio polish

Never cut: watch, drift, two-tier judge, Keel Bridge review with live trace, one real action with verify, eval numbers, demo workspace.

## Open questions

| Question | Blocks | Ask where |
|---|---|---|
| Do Marketing API previews show AI-enhanced variants? | M2 variant source | #office-hours, Oct 27 |
| SAM 3.1 request and mask format | M3 | Docs + one test call |
| Does the Model API expose Muse Wonder's Active Memory? | M4 (or store memory ourselves) | Docs, #office-hours |
| Exact Muse Image model ID and edit endpoint | M6 replacement | Docs |
| Ads MCP auth for a headless worker | Insights in cycle | Docs; fall back to Marketing API |
| Facebook Login for Business permissions in development mode | Sign-in with real accounts | Meta app dashboard |
