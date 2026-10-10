# Noulette cloud worker (bring-your-own-deploy). Log monitoring, analysis and a signed approval queue.
# It never sees your repository. Build from the repo root:
#   docker build -f packages/engine/Dockerfile -t noulette-cloud .
#   docker run -p 8787:8787 -e NOULETTE_CLOUD_TOKEN=... -e NOULETTE_CLOUD_SIGNING_SEED=... \
#     -e NOULETTE_POSTHOG_KEY=... -e NOULETTE_POSTHOG_PROJECT=... -v noulette-data:/data noulette-cloud
FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/engine/package.json packages/engine/package.json
RUN bun install --production --frozen-lockfile --filter @noulette/engine
COPY packages/engine/src packages/engine/src
ENV NOULETTE_HOME=/data NODE_ENV=production
VOLUME /data
EXPOSE 8787
USER bun
CMD ["bun", "run", "packages/engine/src/cli.ts", "cloud"]
