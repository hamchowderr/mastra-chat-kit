# Polish 05 — Document the Image Size Trade-off

The Docker image is ~676MB instead of the spec's <400MB target because we use `node:22-slim` (Debian, glibc) instead of `node:22-alpine` (musl) — required for DuckDB native module compatibility.

This is intentional, but it's not obvious. If a contractor or a forking client opens the Dockerfile and sees `node:22-slim`, they might "improve" it back to Alpine and break things at runtime. Or they might assume the template is bloated and mistrust everything else.

The fix: document it once, clearly, where they'll see it.

## Where to document

### 1. README.md — Deployment section

Add a "Deployment notes" subsection if not already present, covering image size:

```markdown
## Deployment notes

### Docker image size

The production image is ~676MB. This is larger than typical Node.js Docker images because:

- The base is `node:22-slim` (Debian, glibc) instead of `node:22-alpine` (musl)
- DuckDB ships native binaries that segfault on musl libc, even with `gcompat`
- DuckDB is required by `@mastra/observability` for trace storage

If you need a smaller image, the path is to swap DuckDB for `LibSQLStore` in the observability domain (see `src/mastra/index.ts`). Trade-off: slower trace queries in Mastra Studio, especially under load.

For typical VPS deployments (Hetzner, DigitalOcean, etc.) the 676MB size is not a problem — pulls take seconds and storage is cheap. Only optimize if you're targeting Lambda, Cloud Run cold starts, or memory-constrained environments under 1GB.
```

### 2. Dockerfile — Inline comment

Add a comment right above the `FROM` line so anyone reading the Dockerfile sees it immediately:

```dockerfile
# Use node:22-slim (Debian/glibc), NOT node:22-alpine (musl).
# DuckDB native modules segfault on Alpine even with gcompat.
# This makes the image ~676MB instead of ~150MB. See README "Deployment notes".
FROM node:22-slim AS build
```

### 3. AGENTS.md — Add to the "things to never do" list

If the AGENTS.md has a "things to never do" section, add:

```markdown
- Do NOT change the Dockerfile base image to `node:22-alpine` or any musl-based image. DuckDB will segfault. See README "Deployment notes" for the reasoning. If you genuinely need a smaller image, swap DuckDB for LibSQL in the observability domain instead.
```

### 4. SPEC/06-known-gotchas.md — Add a section

Update or add a section about the DuckDB / Alpine incompatibility:

```markdown
## DuckDB requires glibc

`@mastra/duckdb` ships native binaries compiled against glibc. These segfault on Alpine Linux (musl libc) even with `gcompat` installed.

The Dockerfile uses `node:22-slim` (Debian-based, glibc) instead of `node:22-alpine` (musl). This costs ~500MB in image size but is required for runtime stability. Do not "optimize" by switching to Alpine — the container will crash on first observability span.
```

## Other small docs to check while you're in there

While editing README.md, sanity-check that:

- The `npm run` scripts table is accurate (`dev`, `build`, `start`, `typecheck`, `eval`, `score:list`)
- The env var table covers all required vars from `src/lib/env.ts`
- The "Common gotchas" section mentions PostHog telemetry, the Supabase pooler URL, and the Pino transport in Docker

If any of those drifted from reality during the build, fix them now.

## What to capture in PROGRESS.md

```
## Polish 05: Documentation Updates
- Status: complete
- Files touched: README.md, Dockerfile, AGENTS.md, SPEC/06-known-gotchas.md
- Image size note: documented in 4 places
- README sanity check: <pass | fixed N items>
- Notes: <anything found that needed fixing during sanity check>
```

## Final wrap-up

After Polish 05, write the final consolidated entry per the polish 00-README.md spec:

```
## Polish complete
- Status: complete
- All 5 polish steps:
  - 01 Manual Studio test: pass
  - 02 GitHub publish & CI: pass — repo at https://github.com/<org>/template-mastra-base
  - 03 Provisioning test: pass
  - 04 Completeness scorer: <replaced with X | dropped | something else>
  - 05 Documentation updates: pass
- Outstanding issues: <if any>
- Recommended next action: ready to start child templates (rag, voice, chat, nca)
```

## You're done

After this, the base template is genuinely production-ready. Hand back to the owner, who will start the four child templates (likely RAG first).
