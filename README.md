# Keel

> **Paste a website. Keel researches the brand, designs the ads, launches them on Meta, guards them once they're live and learns what wins. Every step runs on Meta's own models, and a person approves every change.**

**Meta Global AI Developer Hackathon 2026 · Indie Developer track · Build for Your World**
Demo video: _(link)_ · Built Oct 26 – Nov 4, 2026 by Shalwin Sanju ([@shalwin04](https://github.com/shalwin04))

---

## Why Keel exists

Small brands advertise on Meta with no agency and no designer. Getting one campaign out takes days: research the competition, find an angle, design every placement, write the copy and set up the campaign. Then the work changes hands. **Advantage+ creative enhancements** can rewrite live ads automatically. Brands have found AI-swapped models, distorted products and added music running to real customers, sometimes with settings that switched themselves back on. Meta's position is that reviewing AI output is the advertiser's job.

Keel does both jobs:

1. **Make.** Autopilot takes one link and produces a researched, art-directed, Spark-checked campaign with a Reel storyboard. It launches only when you say so, paused and with enhancements off.
2. **Guard.** The watchdog checks every ad and every variant Meta may serve, catches enhancement drift, judges variants against the approved original and your brand rules, and fixes problems after you approve. Every fix is verified by reading the ad back from Meta.
3. **Learn.** Results feed brand memory. Autopilot proposes the next move (go live, pause a loser, raise the budget within a cap, a new variant of the winner) and waits for approval.

---

## Meta models and tools used

| Model / tool | Where Keel uses it |
|---|---|
| **Muse Wonder** (`muse-wonder-1.0`) | Brand profile from the website; the **research agent** (a tool loop over web search, the Ad Library, competitor sites, reviews and Reddit); voice of the customer; strategy and campaign story; concept planning; brand memory; Autopilot learnings; the watchdog's investigator; rulebook drafts |
| **Muse Image** (`muse-image-1.0`) | Designs **whole ads**, with the real product passed as `@Image` references and the exact text, at 1:1, 4:5 and 9:16; Reel shots; edits in plain words (Refine); resizes by editing, not cropping; on-brand replacements when the watchdog swaps a bad variant |
| **Muse Spark** (`muse-spark-1.3`) | Checks every design: every word exact, the right product, the brand. Scores concepts for stopping power, clarity, product, text and brand. Analyses past ads for memory. Compares regions in watchdog inspections |
| **Muse Spark Open** (open weights on Baseten) | Cheap first screening of every served variant in the watch cycle |
| **SAM 3.1** | Isolates people, products and text so the watchdog compares like with like. Falls back to whole-image comparison |
| **Marketing API** | Campaigns, ad sets, creatives and ads (created `PAUSED`); insights (CTR, CPC, purchases, CPA, ROAS); enhancement settings; ad previews; relock, revert, replace and pause, each read back to verify |
| **Ad Library API** | Competitors' long-running ads. Without an identity-confirmed token it falls back to competitors' live websites and says so in the agent log |
| **Facebook Login for Business** | Sign-in and ad-account permissions in one step |
| Muse Voice Transcribe | Wired for voice commands in Keel Bridge (stretch) |

---

## The product

Keel Bridge is the web app (`apps/web`). There are two halves: **Create** (Autopilot and Studio) and **Watch** (Review, Activity, Ads, Rules, Audit log).

### 1. Autopilot: paste a website

```
Read the site ─▶ Research ─▶ Craft ─▶ Launch (on approval) ─▶ Learn ─▶ Update
```

- **Read the site.** Playwright crawls the page: JSON-LD and Shopify products, prices, logo, colours, links and photos (`packages/meta/src/site.ts`). Muse Wonder turns this into a **brand profile**: voice, audience (e.g. US · 18–44), products found with a **Lead** product, and competitors to study.
- **Research.** The research agent decides what to read and narrates its work in a live **Agent log**: "No Ad Library access on this account, so the agent studies competitors' websites instead…", then it reads bose.com, sony.com, apple.com and so on.
- **Craft.** It writes three directions, art-directs and designs every placement with Muse Image, checks each design with Spark and draws the Reel storyboard. The top concepts from the concept board are added automatically.
- **Ready to launch.** Choose **Launch and switch on** or **Launch paused**. Nothing spends before you choose.
- **Learn and update.** The worker reads results every `AUTOPILOT_CHECK_HOURS`. Wonder writes learnings, and `planMoves()` (deterministic thresholds) proposes moves that wait for your approval. A *sales* objective judges ads on cost per purchase; others on CTR and CPC.

### 2. Research tab: what the agent studied

The research agent (`packages/agents/src/studio/research.ts`) is a Muse Wonder tool loop with these tools: `web_search`, `read_website`, `search_ad_library`, `look_at_ad`, `read_reviews`, `search_reddit` and `read_reddit_thread`. It returns:

- **What everyone does, what's overused and the opening**: the gap the campaign will take.
- **Voice of the customer**: personas and verbatim phrases from real reviews and threads.
- A source trail for every finding (pages, ads, threads), so every idea traces back to something real.

If the loop fails, a fixed research plan runs instead, so a campaign never stalls.

### 3. Designs tab: the campaign

Each direction (e.g. *Every Version Of You*, *Build Your Lineup*, *Training To Tonight*) shows:

- The **insight it answers**, with "Your product, placed by Muse Image".
- The design in **1:1 Feed, 4:5 Feed and 9:16 Stories**, all made by Muse Image as edits of one master, not crops.
- **Hero / Split / Card** layouts, **New scene** (a fresh Muse Image shoot), **Picked** (goes into the launch), and the scene strip and ad copy.
- **Spark's checks on the design itself.** Problems are flagged in place, e.g. *"Check: ad shows white over-ear headphones, real product is black in-ear earbuds"* or *"Sub-text is cut off and not fully legible"*.
- The **Launch panel**: account, number of ads, budget, dates, audience and destination. It creates everything **paused with Advantage+ AI enhancements off**, and Keel flags any setting that changes later.

**Editor and Refine.** Open any design to see its layers (logo, chip, price, button, subline, headline, shade, scene) and type a change in plain words, e.g. *"warmer light and more depth"*. Muse Image edits the design and Spark re-verifies the text before it replaces the old one.

### 4. Concepts tab: the concept board

Wonder writes many concepts across formats: **Hero, Notes app, Post card, Customer quote, Us vs them, Before/after, Offer, Meme, Creator caption** (POV/UGC). Pick a look: **Art director picks, Studio photo, Lifestyle photo, Cinematic still, 3D render, Clay 3D, Isometric 3D, Flat illustration, Risograph, Paper-cut, Collage**.

- Every card is scored by Spark on **Stop · Clear · Product · Text · Brand**, labelled with its persona and marked *Recommended* or *In campaign*.
- **Make more** adds concepts, **Remix** makes variations of one, and **Refine** edits one in words.
- `vet()` keeps the board honest:
  - Testimonials only quote reviews of **the brand's own product**, never a competitor's negative review.
  - Offers appear only if the brief has one.
  - "Us vs them" never names a competitor.

### 5. Storyboard tab: the Reel

Each direction becomes a **15-second Reel**:

- **Campaign story** in three acts, with dates: *Launch the idea → Show the swap → Make it yours*, each with its line on screen.
- **Reel shots** by Muse Image with the real product. Each 3-second shot has its camera move (push-in, pan-right, static, pull-out) and its on-screen line.
- An **animatic** that plays the whole cut with the moves and lines, so you can judge the Reel before anything is filmed or spent. **Redraw frames** reshoots them.

### 6. The art engine

`packages/agents/src/studio/art.ts`:

1. `artBrief()` writes a 7-part brief:
   1. story;
   2. the real product via `@Image` refs;
   3. style block (`VISUAL_STYLES`);
   4. light and camera;
   5. composition with safe zones;
   6. the exact text in quotes;
   7. an avoid list.

   The market is named, so casting and places feel local.
2. `designAd()` has Muse Image design the whole ad at the target aspect.
3. `verifyDesign()` (Spark) checks every word and the product. On failure it makes one retouch edit, and if that also fails it falls back to a text-free key visual with Keel's live type. A wrong word never ships.
4. `resizeDesign()` makes other sizes by editing; `refineDesign()` applies a worded change.

`museImage()` (`packages/meta/src/models.ts`) handles a quirk of the API. `/images/generations` accepts `size`, while reference edits through `/responses` don't. So the shape is set in the prompt, checked with `imageSize()`, and retried with a grey canvas of the right shape when it comes back wrong. `npm run image:probe` shows what your key accepts; `MUSE_IMAGE_SIZES` overrides the sizes.

### 7. Brand memory

`packages/agents/src/memory.ts`:

- Spark reads the account's past ads that have real delivery (≥ 500 impressions).
- Wonder finds what the winners share: winners, losers, *do more* and *avoid*.
- Every Autopilot learning is added.
- Studio strategy and the concept board read memory before planning anything. You can see it on the **Ads** page.

### 8. Watch: the watchdog

```
ingest ─▶ detect drift ─▶ screen ─▶ inspect ─▶ investigate ─▶ decide ─▶ notify ─▶ wait for approval ─▶ act ─▶ verify ─▶ learn
```

A LangGraph.js cycle (`packages/agents/src/graph.ts`) that runs on a schedule for every watched account:

- **Detect drift.** Enhancement settings are compared with the approved baseline, which is kept per ad.
- **Screen → inspect → investigate.** Muse Spark Open screens every variant cheaply. Suspicious ones go to SAM regions and a Muse Spark comparison, and unclear cases to a Muse Wonder second look. Model calls happen only in these three steps.
- **Decide.** `decide()` is deterministic policy (`packages/core`), using confidence thresholds and what Keel may do without asking.
- **Wait for you.** `interrupt()` pauses the graph; your decision in **Review** resumes it with `Command({ resume })`.
- **Act and verify:**

| Proposal | What Keel does through the Marketing API | How it's verified |
|---|---|---|
| Switch it back off (setting drift) | Copies the creative with the drifted enhancement set to `OPT_OUT` and swaps it in | Reads the ad back: new creative live, enhancement off |
| Restore the approved creative | Same copy with every enhancement off | Same read-back |
| Replace with an on-brand version | Muse Image regenerates from the approved original and the rulebook, uploads it, swaps in a new creative | Same read-back |
| Pause the ad | Sets `PAUSED` | Reads the status back |

Creatives are immutable on Meta, so every fix is a new creative, and the previous id is kept in the audit log. A verified fix becomes the new baseline. If you keep a finding running, Keel remembers it and doesn't raise it again.

| Watch screen | What it's for |
|---|---|
| **Review** | Findings by severity, with a compare slider between the approved original and what Meta served. Approve, replace or keep it running. Keys: J/K, A, R, P, M |
| **Activity** | Each check as it runs: every model call with its time and cost, every action and its verification. "Check now" per account |
| **Ads** | Every watched ad's enhancements against the baseline, with drift highlighted, plus brand memory |
| **Rules** | The plain-language brand rulebook (audience, casting, palette, tone, never-show list, claim limits, enhancements to always keep off), a Muse Wonder draft from your best ads, and the approval policy |
| **Audit log** | Every check, decision and change, hash-chained and verified on load |
| **Settings** | Facebook connection, ad accounts, appearance (light/dark), push alerts, people and roles |

Alerts reach your phone as web push. Only signed-in owners and reviewers can decide; viewers can watch.

---

## Guardrails

- **Nothing spends without a person.** Launches are paused or need an explicit "switch on"; every Autopilot move and every watchdog fix waits for approval.
- **Enhancements off by default**, and any change to them is detected.
- **Read-back verification** after every write to Meta.
- **Honest creative:** real product only (via references), exact text verified by Spark, testimonials only from the brand's own reviews, no named competitors, no invented offers.
- **Hash-chained audit log** of everything that changes state.
- Meta tokens are encrypted at rest (`KEEL_SECRET`), and private and local URLs are refused when reading sites (`assertPublicUrl`).

---

## Architecture

```
                         ┌──────────────── Keel Bridge (React 19 · TanStack · Tailwind 4) ───────────────┐
                         │ Create · Autopilot · Designs · Concepts · Research · Storyboard · Editor       │
                         │ Review · Activity · Ads · Rules · Audit log · Settings                         │
                         └───────────────▲──────────────────────────────────────┬────────────────────────┘
                                         │ SSE · web push                        │ REST
                         ┌───────────────┴──────────────── apps/api (Hono) ──────▼────────────────────────┐
                         │ auth (Facebook Login for Business) · studio · autopilot · review/decisions      │
                         └───────────────▲──────────────────────────────────────┬────────────────────────┘
                                         │                                       │
  apps/worker (scheduler) ───────────────┤                 packages/agents       ▼
   watch cycles · autopilot checks ·     │   graph.ts (LangGraph watch cycle) · autopilot.ts · memory.ts
   approval expiry · crash recovery      │   studio/{research,art,pipeline,models}.ts · actions.ts
                                         │                                       │
                         ┌───────────────┴───────────── packages/meta ───────────▼────────────────────────┐
                         │ Meta Model API (Wonder · Spark · Image · SAM) · open weights (Baseten)          │
                         │ Marketing API · Ad Library · Ads MCP · site crawler (Playwright) · media store  │
                         └─────────────────────────────────────────────────────────────────────────────────┘
                                         packages/db: Postgres + Drizzle, hash-chained audit, events
```

| Path | What's in it |
|---|---|
| `apps/api` | Hono API: sessions, Facebook Login, studio and autopilot routes, review queue, decisions (resume LangGraph), rules, SSE, push, media. Serves the built web app in production |
| `apps/worker` | Scheduler: each watched account on its own interval, Autopilot checks, approval expiry, crash recovery |
| `apps/web` | Keel Bridge. Design tokens in `src/index.css`, primitives in `src/components/ui.tsx` |
| `packages/core` | zod schemas (brief, formats, styles, directions, concepts, memory, design checks), defect codes, `decide()` policy, roles |
| `packages/agents` | Watch cycle, judges, investigator, actions + verification, Autopilot, brand memory, Studio research/art/pipeline |
| `packages/meta` | Model API clients (`museImage`, `runTools`, `groundedSearch`), SAM parser, Marketing API, Ad Library, site crawler, reviews/Reddit readers, preview rendering, media store |
| `packages/db` | Drizzle schema and migrations, audit chain, token crypto, live events, demo seed |
| `eval/` | Labelled variant pairs and a precision/recall runner for the watchdog |
| `tests/e2e` | Full cycles against Postgres with a fake Marketing API: watch (drift → approve → verify → learn), Studio, Autopilot |
| `scripts/` | Migrate, local Postgres, demo seed, add an account, image/research probes |

Stack: TypeScript (strict) · Node 22 · Hono · LangGraph.js · Drizzle + Postgres · React 19 + TanStack Router/Query + Tailwind 4 · Playwright · Vitest.

---

## Run it locally

Requires Node 22.9+ and Postgres (Docker, or `npm run db:local` for an embedded one).

```bash
npm install
cp .env.example .env          # set KEEL_SECRET, DATABASE_URL; add META_API_KEY for real models
npm run db:migrate            # apply migrations
npm run db:seed               # optional: Northline demo workspace
npm run dev:api               # API on :8787
npm run dev:web               # Keel Bridge on :5173 → "Developer sign-in" or "Explore the demo"
npm run dev:worker            # scheduler (watch cycles + Autopilot checks)
```

Open http://localhost:5173, go to **Create** and paste a website.

**No Meta keys yet?** Set `STUDIO_FAKE_MODELS=1` to run Studio and Autopilot end to end with deterministic stand-ins.

### Useful commands

```bash
npm run check                 # typecheck + unit tests
npm run test:e2e              # watch cycle against your DB with a fake Marketing API
npm run test:e2e:studio       # Studio pipeline end to end
npm run test:e2e:autopilot    # Autopilot end to end
npm run cycle:once            # one watch pass over every account (or `-- act_123`)
npm run account:add           # register META_AD_ACCOUNT_ID for the developer sign-in
npm run image:probe           # what Muse Image accepts with your key (sizes, refs, exact text)
npm run research:probe        # check Ad Library / search / tool calling access
npm run research:agent        # run the research agent on its own
npm run eval                  # watchdog eval set (needs model keys)
npm run build                 # web app → apps/web/dist
```

### Key settings (`.env.example` has them all)

| Variable | Purpose |
|---|---|
| `META_API_KEY`, `META_API_BASE` | Meta Model API (OpenAI-compatible) |
| `MODEL_SPARK`, `MODEL_WONDER`, `MODEL_IMAGE`, `MODEL_SAM` | Model ids |
| `OPENWEIGHT_BASE_URL`, `OPENWEIGHT_API_KEY`, `OPENWEIGHT_MODEL` | Muse Spark Open screening tier (optional) |
| `META_SYSTEM_USER_TOKEN`, `META_AD_ACCOUNT_ID` | Marketing API access for accounts added by id |
| `META_AD_LIBRARY_TOKEN` | Ad Library research (optional; falls back to competitor websites) |
| `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` | Facebook Login for Business |
| `STUDIO_ART_ENGINE`, `STUDIO_DESIGN_TAKES`, `STUDIO_CONCEPTS`, `MUSE_IMAGE_SIZES` | Art engine and concept board |
| `AUTOPILOT_CHECK_HOURS`, `AUTOPILOT_MIN_IMPRESSIONS` | Autopilot cadence and thresholds |
| `DATABASE_URL`, `KEEL_SECRET`, `PUBLIC_BASE_URL` | Required for the app |

## Deploy

`docker compose up -d --build` runs Postgres, the API (which also serves Keel Bridge) and the worker. See [docs/DEPLOY.md](docs/DEPLOY.md) for a single VM, Railway/Render/Fly, and the Meta app settings for production.

More: [docs/IDEATION.md](docs/IDEATION.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/PLAN.md](docs/PLAN.md) · [PRIVACY.md](PRIVACY.md)

---

## Built during the hackathon

Everything in this repository was written during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026), and the commit history shows each feature as it was built. No code was carried over from earlier projects.

| Date | Built |
|---|---|
| Oct 26 | Spec, architecture, scaffold, agent cycle skeleton |
| Oct 27 | Per-package tests, build plan; Keel Bridge replaces the WhatsApp idea |
| Oct 31 | Real fixes with read-back verification, scheduler and learning; redesigned Keel Bridge (Review, Activity, Ads, Rules, Audit, Settings); Docker, compose, CI, privacy policy; **Keel Studio** (agentic campaign creation) |
| Nov 1 | Competitor research, art direction and the Reel storyboard; **Autopilot**: paste a website, Keel runs the campaign |
| Nov 2 | Network retries to Meta; clearer DB errors; Ad Library access handling and competitor-website fallback; **research agent** (Muse Wonder tool loop) |
| Nov 3 | **Concept board**, voice of the customer, **brand memory**, sales objective; **art engine** (Muse Image designs whole ads, Spark checks every word); reference-edit shape handling; market-aware casting |
| Nov 4 | Demo run on beatsbydre.com, demo video, this README |

> The demo uses beatsbydre.com as a public example site. It is not affiliated with Beats or Apple, and the campaign was created paused in a test ad account.

## License

MIT © 2026 Shalwin Sanju
