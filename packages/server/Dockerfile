# syntax=docker/dockerfile:1.7

# Use node:22-slim (Debian/glibc), NOT node:22-alpine (musl).
# DuckDB native modules segfault on Alpine even with gcompat.
# This makes the image ~676MB instead of ~150MB. See README "Deployment Notes".
# ─── Stage 1: build ───────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# --studio bundles the Studio SPA so it can be served self-hosted in production.
RUN npx mastra build --studio
# Bake Studio config: auto-detect server from same origin → no "enter URL" form,
# works for any deploy domain with no per-deploy config.
RUN node scripts/bake-studio.mjs

# ─── Stage 2: runtime ─────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

# tini — proper signal handling for SIGTERM
# node:22-slim is Debian-based (glibc), so no gcompat needed for native modules (e.g. DuckDB)
RUN apt-get update && apt-get install -y --no-install-recommends tini wget && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/sh -M mastra && \
    chown -R mastra:nodejs /app

ENV NODE_ENV=production
ENV PORT=4111
# Serve the bundled Studio UI (chat, traces, editor) from the same server.
# Secure it behind auth before exposing publicly (see Mastra Studio auth docs).
ENV MASTRA_STUDIO_PATH=/app/.mastra/output/studio

COPY --from=build --chown=mastra:nodejs /app/.mastra/output ./.mastra/output

USER mastra
EXPOSE 4111

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4111/health > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", ".mastra/output/index.mjs"]
