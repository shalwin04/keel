# Deploying Keel

Keel is two processes from one image plus Postgres:

| Process | Command | What it does |
|---|---|---|
| api | `npm run start:api` (default `CMD`, runs migrations first) | Serves Keel Bridge and the API on `PORT` |
| worker | `npm run start:worker` | Every minute: expires overdue requests, starts a check for each account whose interval has passed |

Both need the same `.env`. Captured images (rendered previews, originals, replacements) live in `MEDIA_DIR`; give it a persistent volume shared by both.

## 1. Production `.env`

Start from `.env.example`, then:

```bash
NODE_ENV=production
KEEL_SECRET=$(openssl rand -hex 32)        # never change it later: it encrypts stored Meta tokens
PUBLIC_BASE_URL=https://keel.example.com
WEB_BASE_URL=https://keel.example.com
DEV_AUTH=0
DEMO_ENABLED=1                             # optional, for judges
META_API_KEY=…   OPENWEIGHT_API_KEY=…
META_APP_ID=…    META_APP_SECRET=…    META_LOGIN_CONFIG_ID=…
VAPID_PUBLIC_KEY=…  VAPID_PRIVATE_KEY=…  VAPID_SUBJECT=mailto:you@example.com
```

The API refuses to start in production with a short `KEEL_SECRET`, a non-https `PUBLIC_BASE_URL`, or `DEV_AUTH=1`.

## 2a. A single VM (simplest)

Any VM with Docker (2 GB RAM is enough; Chromium for previews is the heaviest part):

```bash
git clone https://github.com/<you>/keel && cd keel
cp .env.example .env   # fill in as above
docker compose up -d --build
docker compose exec api npx tsx scripts/seed.ts   # optional demo workspace
```

Put HTTPS in front with Caddy (`caddy reverse-proxy --from keel.example.com --to localhost:8787`) or your host's load balancer. SSE (`/api/events`) needs proxy buffering off; Caddy does this by default.

## 2b. Railway / Render / Fly

- Create a Postgres database and set `DATABASE_URL`.
- Create two services from this repo's `Dockerfile`:
  - **web**: default command, HTTP port `8787`, health check `/health`.
  - **worker**: command `npm run start:worker`, no port.
- Attach one volume at `/data` to both (or set `MEDIA_DIR` to a shared disk). If your host can't share a volume between services, run the worker inside the web service instead: `sh -c "npx tsx scripts/migrate.ts && (npm run start:worker &) && npm run start:api"`.

## 3. Meta app for production

In developers.facebook.com → your app:

1. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**: add `https://keel.example.com/auth/meta/callback`.
2. **App settings → Basic**: set the App Domain, privacy policy URL and terms URL.
3. Development mode is enough for your own ad accounts and anyone you add as an app tester. To let any business connect, switch to Live and request Advanced Access for `ads_read`, `ads_management` and `business_management` (App Review).

## 4. Check it

```bash
curl https://keel.example.com/health        # {"ok":true}
```

Sign in with Facebook, pick an ad account in Settings, then open Activity: the first check starts within a minute.

## Operations

- **Logs** are one JSON object per line (`svc`, `msg`, `ms`, `status`, `error`).
- **Backups**: Postgres holds everything except images; back up the database and the `/data` volume.
- **Scaling**: run one worker. The API can run several instances behind a load balancer; the in-memory rate limiter is per instance.
- **Upgrades**: `docker compose up -d --build`; migrations run on API start.
