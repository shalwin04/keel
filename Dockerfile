# One image for both processes: `api` (serves Keel Bridge + the API) and `worker` (the scheduler).
#   docker build -t keel .
#   docker run --env-file .env -p 8787:8787 keel            # api
#   docker run --env-file .env keel npm run start:worker    # worker

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/agents/package.json packages/agents/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/meta/package.json packages/meta/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build -w @keel/web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8787 MEDIA_DIR=/data/media PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app .
# Headless Chromium renders Meta's ad previews into images the judges can see.
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/media && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npm run start:api"]
