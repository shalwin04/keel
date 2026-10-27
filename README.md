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
| Review | Findings sorted by severity. Drag the waterline between the approved original and what Meta served, toggle outlines of what changed, then approve, replace or leave it. Keyboard: J/K, A, R, P, M. |
| Live trace | Each step of a check as it runs, with every model call, its tier and timing. |
| Accounts | Health per ad account, and the enhancement lock board: current settings against approved ones, drift in red. |
| Audit log | Every check, decision and change, hash-chained and verified on load. |
| Connect an account | Facebook Login, pick an ad account, and Muse Wonder drafts the brand rulebook from your best ads. |

Alerts reach your phone as web push (install Keel Bridge as an app). Decisions come from signed-in owners and reviewers only; viewers can watch.

Details: [docs/IDEATION.md](docs/IDEATION.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/PLAN.md](docs/PLAN.md)

## Repo

```
apps/api       Hono API: sessions, Facebook Login, review queue, decisions, SSE, push
apps/worker    scheduler running the LangGraph watch cycle
apps/web       Keel Bridge (Vite + React + TanStack)
packages/core  schemas, defect taxonomy, decision policy, roles
packages/agents  LangGraph cycle, judges, rulebook drafting, runtime wiring, push
packages/meta  Meta Model API, open-weight, SAM 3.1, Marketing API, Ads MCP clients
packages/db    Drizzle schema, hash-chained audit log, token encryption, live events, demo seed
eval/          labelled variant pairs + precision/recall runner
scripts/       local Postgres, demo seed
```

Unit tests live in a `tests/` folder beside each package's `src/` (for example `packages/agents/tests/graph.test.ts`).

## Run locally

```bash
nvm use                       # Node 22
npm install
cp .env.example .env          # set KEEL_SECRET; Meta keys can wait
npm run db:local              # Postgres in .data/pg, no Docker needed (leave running)
npm run db:migrate
npm run db:seed               # Northline demo workspace
npm run dev:api               # :8787
npm run dev:web               # :5173 → "Developer sign-in" or "Explore the demo workspace"
npm run cycle:once            # one real watch cycle against META_AD_ACCOUNT_ID (needs Meta keys)
npm test                      # unit tests
npm run eval                  # eval set
```

## Built during the hackathon

Everything in this repository was written during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). The first commit (Oct 27) is the initial scaffold; the commit history shows each feature as it was built. No code was carried over from earlier projects.

| Date | Built |
|---|---|
| Oct 27 | Product spec, architecture, scaffold, decision policy, drift detection, approval interrupt, audit chain |
| Oct 27 | Keel Bridge: review queue with compare viewer, live trace, lock board, audit log, onboarding, Facebook Login, roles, live events, web push, demo workspace |

## License

MIT
