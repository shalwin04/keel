# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Keel watches Meta Advantage+ ads: it detects AI enhancement settings that drift from the approved baseline, judges served variants against the approved original and a brand rulebook, and fixes problems through the Marketing API only after a person approves in **Keel Bridge** (the web app in `apps/web`). Every change is verified by reading the ad back from Meta.

## Commands

```bash
npm install
npm run dev:api        # Hono API on :8787
npm run dev:web        # Vite on :5173 (proxies /api and /auth to :8787)
npm run dev:worker     # scheduler
npm run cycle:once     # one pass over every watched account (or `-- act_123`)
npm run check          # typecheck + unit tests
npm run test:e2e       # full cycle against DATABASE_URL with a fake Marketing API
npm run db:generate    # new migration after editing packages/db/src/schema.ts
npm run db:migrate     # apply migrations (uses the app's client; prints errors)
npm run db:seed        # demo workspace
npm run account:add    # register META_AD_ACCOUNT_ID for the developer sign-in
npm run build          # web app → apps/web/dist (served by the API in production)
```

## Layout

- `apps/api` — Hono: auth (Facebook Login for Business, demo, dev), review queue, decisions (resume LangGraph), rules/policy, SSE, push, media; serves `apps/web/dist` in production.
- `apps/worker` — scheduler (`dueAccounts`, `sweep`).
- `apps/web` — React 19 + TanStack Router/Query + Tailwind 4. Design tokens in `src/index.css`; primitives in `src/components/ui.tsx`.
- `packages/core` — zod schemas, defect codes, `decide()` policy, `canDecide()` roles.
- `packages/agents` — `graph.ts` (cycle), `judges.ts` (screen/inspect/investigate), `actions.ts` (execute + verify), `runtime.ts` (wiring to DB/Meta), `scheduler.ts`.
- `packages/meta` — Model API, Muse Image, SAM parser, Marketing API client, preview rendering, media store.
- `packages/db` — Drizzle schema + migrations, audit chain, crypto, events, demo seed.

## Autopilot (Create → paste a website)

read site (`packages/meta/src/site.ts`: Playwright crawl, JSON-LD/Shopify products, logo, colours) → brand profile (Wonder) → brief → Studio run (research → strategy → art-directed scenes → layouts → checks → storyboard) → **launch on approval** (paused or on) → worker `autopilot.check()` every `AUTOPILOT_CHECK_HOURS`: insights → learnings (Wonder) → `planMoves()` (deterministic thresholds) → moves wait for approval (go live, pause ad, raise budget ≤ cap, new variant of the winner). Code: `packages/agents/src/autopilot.ts`, `apps/api/src/autopilot.ts`, `apps/web/src/pages/Autopilot.tsx`.

## Watch cycle

ingest → detectDrift → screen → (inspect → investigate) → decide → (notify → requestApproval) → act → verify → learn

- Model calls only in screen, inspect, investigate. `decide()` is deterministic.
- `requestApproval` uses `interrupt()`; the decision endpoint resumes with `Command({ resume })`. Thread id = cycle id. Side effects before an interrupt live in their own node (`notify`) so a resume doesn't repeat them.
- Baselines are per **ad** (an Ads Manager edit creates a new creative id). A verified fix or a rejected drift updates the baseline.
- Creatives are immutable: relock/revert/replace clone the creative and swap it in.

## Conventions

- TypeScript strict; validate external data with zod at the boundary.
- Audit everything that changes state (`rt.audit`); the chain is hash-linked and must stay intact.
- UI: plain-language copy, one accent colour, colour only for meaning; animate transform/opacity only with `--ease-out`, ≤ 250 ms; respect reduced motion.
- Never commit `.env`. `.env.example` holds names only.
