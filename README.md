# Keel

> **Keel keeps your brand steady while Meta's AI steers your ads.**

Meta's Advantage+ creative enhancements change live ads automatically — and brands have found AI-swapped models, distorted bodies and altered products running to real customers, with settings that switch themselves back on. Meta says reviewing AI output is the advertiser's job. Keel is the agent that does that job.

Keel connects to an ad account, watches every ad and every variant Meta may serve, detects enhancement settings that drift, judges each variant against the approved original and a brand rulebook, and — only with the owner's approval on WhatsApp — pauses, reverts or replaces the ad, then verifies the change.

**Meta Global AI Developer Hackathon 2026 · Indie Developer track · Build for Your World**

## How it works

```
Watch ─▶ Detect drift ─▶ Screen ─▶ Inspect ─▶ Investigate ─▶ Decide ─▶ Ask owner ─▶ Act ─▶ Verify ─▶ Learn
```

| Step | Meta tooling |
|---|---|
| Watch ads, creatives, enhancement settings, variant previews | Marketing API, Ads MCP |
| Screen every variant cheaply | Muse Spark Open / Muse Glimmer (open weights, Baseten · Modal) |
| Isolate people, products, text | SAM 3.1 |
| Compare regions, explain the problem | Muse Spark |
| Draft and refine the brand rulebook; investigate ambiguous cases | Muse Wonder |
| Make an on-brand replacement | Muse Image |
| Approve by voice note | Muse Voice Transcribe |
| Alert and approve | WhatsApp Cloud API |

Details: [docs/IDEATION.md](docs/IDEATION.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Repo

```
apps/api       Hono API: REST, WhatsApp webhook (resumes paused cycles)
apps/worker    scheduler running the LangGraph watch cycle
apps/web       Vite + React dashboard
packages/core  schemas, defect taxonomy, deterministic decision policy
packages/agents  LangGraph cycle, judges, prompts, runtime wiring
packages/meta  Meta Model API, open-weight, SAM 3.1, Marketing API, Ads MCP, WhatsApp clients
packages/db    Drizzle schema, hash-chained audit log
eval/          labelled variant pairs + precision/recall runner
```

Unit tests live in a `tests/` folder beside each package's `src/` (for example `packages/agents/tests/graph.test.ts`).

## Run locally

```bash
nvm use                       # Node 22
npm install
cp .env.example .env          # fill in keys
docker run -d --name keel-pg -e POSTGRES_USER=keel -e POSTGRES_PASSWORD=keel -e POSTGRES_DB=keel -p 5432:5432 postgres:16
npm run db:generate && npm run db:migrate
npm run dev:api               # :8787
npm run cycle:once            # one watch cycle against META_AD_ACCOUNT_ID
npm run dev:web               # dashboard
npm test                      # unit tests (policy, drift, tokens, audit chain, approval interrupt)
npm run eval                  # eval set
```

## Built during the hackathon

Everything in this repository was written during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). The first commit (Oct 27) is the initial scaffold; the commit history shows each feature as it was built. No code was carried over from earlier projects.

| Date | Built |
|---|---|
| Oct 27 | Product spec, architecture, monorepo scaffold, decision policy, drift detection, approval interrupt, audit chain |

## License

MIT
