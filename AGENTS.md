# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

> **`AGENTS.md` and `CLAUDE.md` are kept byte-identical.** `AGENTS.md` is the
> vendor-neutral convention, `CLAUDE.md` is Claude Code's; both are read by
> different tools and both must say the same thing. Edit one, mirror it to the
> other — `bd preflight --check` fails on drift. Beads owns the block between the
> BEADS INTEGRATION markers; regenerate that with `bd setup claude && bd setup codex`
> rather than editing it by hand.

`bd dolt push` pushes beads data to the configured remote, and a session is not
finished without it.

**Never point that remote at the git origin.** Beads defaults `sync.remote` to
the git `origin`, and a successful push then writes a `__dolt_remote_info__`
branch to GitHub. This repo was connected to a Vercel project that built every
branch, and that one holds a single file and no `packages/web`, so each push
queued a deployment that died at checkout in ~1s. On 2026-08-01 the remote was
repointed at a local directory (`.beads/config.yaml` carries the detail) and the
Vercel project was deleted. Clearing the key is *not* enough — `bd dolt push`
re-derives it from git origin and rewrites the file; only a non-git remote holds.

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
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

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
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

**pnpm only.** This is a pnpm workspace — always install from the repo root.
Running `npm install` inside `packages/server` writes a second lockfile that can
resolve different versions than dev and CI tested; that is what shipped a
container running an untested dependency tree (`mastra-chat-kit-j0p`).

```bash
pnpm install                 # from the repo root, always
pnpm dev                     # server (:4111) + web (:3000) together
pnpm --filter @mastra-chat-kit/server dev   # just the server + Studio

pnpm lint                    # biome
pnpm typecheck               # both packages, sources AND tests
pnpm test                    # server + web unit/integration tiers
pnpm test:e2e                # Playwright, against a production web build
pnpm check:dockerignore      # the cheap container guardrail
```

Run what CI runs before opening a PR:

```bash
pnpm lint && pnpm typecheck && pnpm check:dockerignore && pnpm test \
  && pnpm --filter @mastra-chat-kit/web build
```

Every test tier is AIMock-backed and costs nothing — real provider keys are
absent by design, so an accidental live call fails loudly instead of billing.
`USE_AIMOCK=true` must be in `packages/server/.env`; a shell variable will not
take, because the server loads that file *over* the process environment.

## Architecture Overview

A two-package pnpm workspace built on Mastra's `AgentController` (announced by
Mastra as the **Agent Harness** — same thing).

- **`packages/server`** — Mastra + Hono on :4111. The AgentController and its
  Session, six agents (chat + code/research/writer/reviewer/data subagents), a
  workspace sandbox (filesystem + shell + browser), and the 14-endpoint route
  contract the web layer proxies to. Storage, threads, observability and vector
  recall all land in libSQL; embeddings run locally via fastembed.
- **`packages/web`** — Next.js 16 App Router on :3000. Two skins (`chat`,
  `chat-minimal`) over one UI-free engine (`lib/agent-controller/`), rendering
  ~50 controller events onto AI Elements.

The chat layer is also published as a shadcn registry — see `docs/registry.md`.

## Conventions & Patterns

- **Never hand-edit `packages/web/registry.json`.** It is generated by
  `scripts/gen-registry.mjs`, which parses the real imports of shipped files; a
  validation gate fails the build if a shipped file imports a module or fetches
  an `/api/*` route that no registry item ships. Edit the generator instead.
- **Keep the engine UI-free.** `lib/agent-controller/` imports only React. A
  skin may not import another skin.
- **`components/ai-elements/` is vendored upstream code.** Patches there are
  submitted to `vercel/ai-elements` and the local copies get dropped once they
  merge, so avoid restructuring those files.
- Changing the Docker build context invalidates the anchoring of every
  `.dockerignore` rule — Docker matches with Go `filepath.Match`, not gitignore
  semantics, so nested rules need a `**/` prefix. Re-audit all of them.
