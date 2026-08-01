# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

**pnpm only, and install from the repo root** — this package is a workspace
member. `npm install` here writes a second lockfile that can resolve versions
dev and CI never tested (`mastra-chat-kit-j0p`).

```bash
pnpm dev              # mastra dev — Studio at :4111
pnpm build            # mastra build → .mastra/output/
pnpm test             # vitest, AIMock-backed (globalSetup boots the mock on :4010)
pnpm typecheck        # tsc --noEmit over src/ AND tests/
pnpm setup:browser    # fetch the Chromium the Browser panel drives (once)
```

`USE_AIMOCK=true` must live in `.env` — a shell variable will not take, because
the server loads `.env` *over* the process environment. Same trap for `LOG_LEVEL`.

## Architecture Overview

Mastra + Hono on :4111. `src/mastra/index.ts` boots env → AIMock → Mastra and
registers the AgentController route contract; `src/mastra/lib/agent-controller.ts`
wires the controller and its Session over `chatAgent`, with code/research/writer/
reviewer/data subagents and a workspace (filesystem + shell + browser). Storage,
threads, observability and semantic recall all run on libSQL; embeddings are
local via fastembed. Dolt versioned data is optional and off by default.

## Conventions & Patterns

- `src/lib/env.ts` is Zod-validated and crashes on bad config — add new env vars
  there, not with bare `process.env` reads.
- Tests are hermetic and AIMock-backed. Real provider keys are absent by design;
  an accidental live call should fail loudly rather than bill.
- Tools are invoked in tests through `tests/helpers/call-tool.ts`, which narrows
  the optional `execute` and the unbuildable `AgentToolExecutionContext` in one
  place — don't re-scatter `as any` casts at call sites.
