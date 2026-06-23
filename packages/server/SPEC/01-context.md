# 01 — Context

## What this template is

`template-mastra-base` is the foundation template for a family of Mastra agent project templates owned by Otaku Solutions. It's the **lean base** — the children (`template-mastra-rag`, `template-mastra-voice`, `template-mastra-chat`, `template-mastra-nca`) fork from this and add category-specific functionality.

Every fork inherits: env loader, AIMock support, structured logging, Docker setup, scorer + eval harness, agent conventions, prompts folder for AI coding agents.

## Owner's working model

- **Build → educate → consult → resell.** The owner builds for themselves first, then delivers to clients. Templates must be reusable across many client projects with minimal adaptation.
- **Multi-client, multi-VPS.** Each client gets their own Mastra deployment, often on a small VPS (Hetzner / DO / similar). This template targets that deployment shape.
- **Supabase-first.** Postgres for state, pgvector for RAG, signed URLs for file ops. Avoid alternative DBs unless a client specifically requires it.

## Decisions already made (do not relitigate)

| Decision | What | Why |
|---|---|---|
| Storage adapter | `@mastra/pg` for default domain, DuckDB for observability domain (default scaffold pattern) | Multi-container safe; matches Mastra's recommended composite store; pgvector ready for RAG fork |
| Logger | `PinoLogger` from `@mastra/loggers` | Mastra's official wrapper; integrates with Studio + observability |
| Observability | `Observability` from `@mastra/observability` with `DefaultExporter` only | Streams to Mastra Studio. Sentry / Braintrust / Langfuse can be added later as custom exporters. |
| Scorer philosophy | **Hybrid**: continuous (sampling on real traffic) + CI gate (offline runner against canonical dataset) | Catches drift in production AND blocks regressions before merge |
| Default LLM | `anthropic/claude-sonnet-4-6` | Owner default; all three providers' keys go in env so child agents can choose |
| LLM mocking | `@copilotkit/aimock` for deterministic tests | Free, fast, deterministic CI runs |
| Voice provider (for the future voice template, not here) | `@mastra/voice-google-gemini-live` | Gemini Live STS; uses owner's existing Google API key |
| Deployment | Docker + docker-compose | Process supervision via Docker; reverse proxy via Caddy/Nginx (deployment-time, not template-time) |
| RAG | **Not in this template**; lives in `template-mastra-rag` | Keeps base lean |
| Sentry | **Not in this template** for now; can be added later as custom observability exporter | Mastra Studio handles current needs |
| VAPI / LiveKit | **Not in this template**; they're external platforms that call Mastra's auto-generated REST endpoint | No custom plumbing needed at template level |
| NCA Toolkit | **Not in this template**; lives in `template-mastra-nca` | Keeps base lean |
| TypeScript path aliases inside `src/mastra/` | **Not used** — relative imports only | Mastra's bundler has known issues resolving aliases in some configurations |

## What this template ships with

A canonical example agent (`leadIntake`) that demonstrates every convention: structured output (Zod), one tool, scorer registration with sampling config, JSDoc README block, env-driven config, paired CI eval dataset. Devs adding new agents copy this file as a starting point.

## What this template does NOT ship

- Custom logger code (use `mastra.getLogger().child()`)
- Custom scorer harness (use `@mastra/core/evals` + `@mastra/evals`)
- Sentry integration
- Pgvector / RAG
- Voice
- Frontend (Next.js)
- VAPI/LiveKit webhooks
- NCA Toolkit tools
- A custom Express/Hono server (Mastra's auto-generated server is sufficient)
- PM2 / systemd configs (Docker handles process supervision)
- Caddy / Nginx configs (those are deployment-time)

## Quality bar

- **Typecheck must pass** with zero errors and no `any`.
- **Mastra build must succeed** (`npx mastra build`) — this is the production bundle.
- **Live smoke test must succeed** — the example agent responds correctly with real Anthropic key.
- **CI eval gate must pass** — running the offline scorer against AIMock fixtures returns scores ≥ thresholds.
- **Docker build must succeed** and the container must boot to a healthy state.

If any of these fail, the build is incomplete. Document the failure in `PROGRESS.md` and either fix it or escalate to the owner.
