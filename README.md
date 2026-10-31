# Keel

> **Keel keeps your brand steady while Meta's AI steers your ads.**

Meta's Advantage+ creative enhancements change live ads automatically, and brands have found AI-swapped models, distorted bodies and altered products running to real customers, with settings that switch themselves back on. Meta says reviewing AI output is the advertiser's job. Keel is the agent that does that job.

Keel connects to an ad account, watches every ad and every variant Meta may serve, detects enhancement settings that drift, and judges each variant against the approved original and a brand rulebook. Findings land in **Keel Bridge**, a web app where the owner compares the two images and decides. Only then does Keel pause, revert or replace the ad, and it reads the ad back from Meta to confirm.

**Meta Global AI Developer Hackathon 2026 · Indie Developer track · Build for Your World**

## How it works

```
Watch ─▶ Check settings ─▶ Screen ─▶ Inspect ─▶ Investigate ─▶ Decide ─▶ Alert ─▶ Wait for you ─▶ Act ─▶ Verify ─▶ Learn
```

| Step | Meta tooling |
|---|---|
| Watch ads, creatives, enhancement settings, variant previews | Marketing API, Ads MCP |
| Screen every variant cheaply | Muse Spark Open / Muse Glimmer (open weights, Baseten · Modal) |
| Isolate people, products, text | SAM 3.1 |
| Compare regions, explain the problem | Muse Spark |
| Draft the brand rulebook; investigate unclear cases | Muse Wonder |
| Make an on-brand replacement | Muse Image |
| Sign in and grant ad access | Facebook Login for Business |
| Voice commands in Keel Bridge (stretch) | Muse Voice Transcribe |

## Keel Bridge

| Screen | What it's for |
|---|---|
| Review | Findings sorted by severity, with a compare slider between the approved original and what Meta served. Approve, replace with an on-brand version, or keep it running. Keyboard: J/K, A, R, P, M. A "Decided" tab shows every outcome Meta confirmed. |
| Activity | Each check step by step as it runs, with every model call, its time and cost, and every action and its verification. "Check now" per account. |
| Ads | Every watched ad with its Advantage+ enhancements against the approved baseline; drifted settings highlighted. Per-account schedule and on/off. |
| Rules | The brand rulebook (audience, casting, palette, tone, banned content, claim limits, enhancements to always keep off), a Muse Wonder draft from your best ads, and approval policy: what Keel may do without asking, minimum confidence, how long requests stay open. |
| Audit log | Every check, decision and change, hash-chained and verified on load. |
| Settings | Facebook connection and ad accounts, appearance (light/dark), review alerts on this device, people. |

Alerts reach your phone as web push (install Keel as an app). Decisions come from signed-in owners and reviewers only; viewers can watch.

## What happens when you approve

| Proposal | What Keel does through the Marketing API | How it's verified |
|---|---|---|
| Switch it back off (setting drift) | Copies the ad's creative with the drifted enhancement set to `OPT_OUT`, swaps it into the ad | Reads the ad back: new creative is live and the enhancement is off |
| Restore the approved creative | Same copy with every enhancement off | Same read-back |
| Replace with an on-brand version | Muse Image regenerates the image from the approved original and the rulebook, uploads it, swaps in a creative that uses it, enhancements off | Same read-back |
| Pause the ad | Sets the ad to `PAUSED` | Reads the status back |

Creatives are immutable on Meta, so every fix is a new creative; the previous creative id is kept in the audit log. A verified fix becomes the ad's new baseline. If you keep a finding running, Keel remembers and doesn't raise the same thing again; a kept setting becomes part of the baseline.

Details: [docs/IDEATION.md](docs/IDEATION.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/PLAN.md](docs/PLAN.md) · [docs/DEPLOY.md](docs/DEPLOY.md)

## Repo

```
apps/api       Hono API + serves the built web app: sessions, Facebook Login, review queue, decisions, rules, SSE, push
apps/worker    scheduler: every watched account on its own interval, approval expiry, crash recovery
apps/web       Keel Bridge (Vite + React + TanStack + Tailwind)
packages/core  schemas, defect taxonomy, decision policy, roles
packages/agents  LangGraph cycle, judges, investigator, actions + verification, scheduler, runtime wiring, push
packages/meta  Meta Model API, open-weight, SAM 3.1, Muse Image, Marketing API, preview rendering, media store
packages/db    Drizzle schema + migrations, hash-chained audit log, token encryption, live events, demo seed
eval/          labelled variant pairs + precision/recall runner
tests/e2e      full cycle against Postgres with a fake Marketing API (drift → approve → verify → learn)
scripts/       migrate, local Postgres, demo seed, add an account
```

## Run locally

```bash
nvm use                       # Node 22+
npm install
cp .env.example .env          # set KEEL_SECRET and DATABASE_URL; Meta keys can wait
npm run db:migrate            # Postgres from Docker, or `npm run db:local` for one without Docker
npm run db:seed               # Northline demo workspace
npm run dev:api               # :8787
npm run dev:web               # :5173 → "Developer sign-in" or "Explore the demo"
npm run dev:worker            # the scheduler (or `npm run cycle:once` for one pass over every account)
```

```bash
npm run check                 # typecheck + unit tests
npm run test:e2e              # full cycle against your database with a fake Marketing API
npm run eval                  # eval set (needs model keys)
```

## Deploy

`docker compose up -d --build` runs Postgres, the API (which also serves Keel Bridge) and the worker. See [docs/DEPLOY.md](docs/DEPLOY.md) for a single VM, Railway/Render/Fly, and the Meta app settings for production.

## Built during the hackathon

Everything in this repository was written during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). The first commit (Oct 27) is the initial scaffold; the commit history shows each feature as it was built. No code was carried over from earlier projects.

| Date | Built |
|---|---|
| Oct 27 | Product spec, architecture, scaffold, decision policy, drift detection, approval interrupt, audit chain |
| Oct 27 | Keel Bridge: review queue with compare viewer, live trace, lock board, audit log, onboarding, Facebook Login, roles, live events, web push, demo workspace |
| Oct 29 | First real cycle against a live ad account; per-ad baselines (edits create new creative ids) |
| Oct 30 | Production pass: relock/revert/replace actions with read-back verification, preview rendering, tolerant SAM parsing, Muse Wonder investigator, learning from dismissals, multi-account scheduler with expiry, rulebook and policy editors, redesigned UI with dark mode, Docker + CI, end-to-end test |

## License

MIT
