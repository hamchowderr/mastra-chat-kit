# syntax=docker/dockerfile:1.7

# Storage runs on libSQL/Turso; observability uses DuckDB, whose native binaries
# need glibc (they segfault on musl). So node:22-slim (Debian, glibc) is required
# here — do NOT switch to node:22-alpine.
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

# The workspace's headless browser (@mastra/browser-viewer → playwright-core) drives a
# version-matched Chromium. `mastra build` externalizes @mastra/browser-viewer, which
# depends on playwright-core, so both land in output/node_modules — but a slim image
# ships neither the browser BINARY nor Chromium's ~40 system libraries. Provision both
# here into a fixed path that this install AND the runtime process read via
# PLAYWRIGHT_BROWSERS_PATH. Runs as root (apt) before the USER switch; chown so the
# non-root `mastra` user can launch it. Browser tools are lazy, so this only matters at
# first browser use — but without it those calls fail (fs/shell/memory work regardless).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node .mastra/output/node_modules/playwright-core/cli.js install --with-deps chromium \
    && chown -R mastra:nodejs /ms-playwright \
    && rm -rf /var/lib/apt/lists/*

# Persistent libSQL storage dir. Create it owned by the runtime user so the named
# `libsqldata` volume mounted here (docker-compose.yml) inherits that ownership on
# first init — the non-root `mastra` user must be able to write the DB file.
RUN mkdir -p /app/data && chown mastra:nodejs /app/data

USER mastra
EXPOSE 4111

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4111/health > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", ".mastra/output/index.mjs"]
