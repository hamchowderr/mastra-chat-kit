# Polish 02 — GitHub Publish & CI Verification

Push the template to GitHub, configure secrets, watch CI run green. This proves the template is publicly hosted and the CI workflow we wrote actually works.

## Prerequisites

- A GitHub account with permission to create repos in the target org/user
- `gh` CLI installed and authenticated (`gh auth status` shows logged in)
- The `CI_APP_SECRET` value generated and ready

If `gh` isn't installed, install via winget: `winget install GitHub.cli`. Then `gh auth login`.

## Steps

### 1. Decide on the repo name and visibility

The convention from the conversation: `your-org/template-mastra-base` where `your-org` is the owner's GitHub org or username. Check with the owner if you don't know which.

**Visibility**: PUBLIC. The template needs to be reachable by `npx create-mastra --template <slug>` from anywhere. Private repos work but require auth setup; public is simpler and matches the use case (templates are designed to be forked).

If the template contains nothing client-confidential — and it shouldn't, that's why we used stub values everywhere — public is correct.

### 2. Confirm `.gitignore` excludes secrets

Before pushing, verify nothing sensitive is staged:

```bash
cd C:\Users\HamCh\code\template-mastra-base
cat .gitignore
git status
```

**Pass criteria:**
- `.gitignore` includes: `.env`, `.env.bak`, `node_modules`, `.mastra`, `mastra.duckdb*`
- `git status` should NOT show: `.env`, `.env.bak`, any file containing real Supabase keys, any file containing the Anthropic API key

If anything sensitive shows up in `git status` as a tracked file, STOP. Add it to `.gitignore`, run `git rm --cached <file>`, and reverify.

### 3. Initialize git if not already

The build phases mentioned git wasn't initialized by `--default`. Check:

```bash
git log --oneline | head -5
```

If you get "fatal: not a git repository" or there are no commits, initialize:

```bash
git init
git add .
git commit -m "Initial commit: template-mastra-base from spec build"
```

If git is already initialized with commits, leave them alone.

### 4. Create the GitHub repo and push

Ask the owner for the org/username if you don't already know it. Once confirmed:

```bash
# Replace <org> with the owner's GitHub username/org
gh repo create <org>/template-mastra-base \
  --public \
  --source=. \
  --description "Foundation Mastra agent template — Supabase-backed, Postgres memory, AIMock-tested, Docker-deployable" \
  --push
```

**Pass criteria:**
- Command exits 0
- Repo URL is printed
- `git remote -v` shows the new origin

### 5. Configure CI_APP_SECRET

The CI workflow needs `CI_APP_SECRET` set as a GitHub Actions secret. Generate it:

```bash
openssl rand -hex 32
```

Copy the output. Then set it as a secret:

```bash
gh secret set CI_APP_SECRET --repo <org>/template-mastra-base
# Paste the value when prompted
```

Or set via the web UI: repo → Settings → Secrets and variables → Actions → New repository secret.

**Pass criteria:**
- `gh secret list --repo <org>/template-mastra-base` shows `CI_APP_SECRET`

### 6. Trigger CI by pushing

CI runs on `push` to main and on `pull_request`. The push from step 4 should have triggered it already. Check:

```bash
gh run list --repo <org>/template-mastra-base --limit 3
```

**Pass criteria:**
- A run is `in_progress` or `completed`
- The most recent run is on the `main` branch

If no run is shown, manually trigger:

```bash
gh workflow run ci.yml --repo <org>/template-mastra-base
```

### 7. Wait for CI to complete

```bash
gh run watch --repo <org>/template-mastra-base
```

Or open the Actions tab in the GitHub UI.

**Pass criteria:**
- All four jobs eventually report ✓:
  - `typecheck` ✓
  - `build` ✓
  - `eval` ✓ (this one runs against AIMock — will skip scorers, only check field assertions)
  - `docker` — only runs on push to main, should also ✓
- Total CI duration: probably 5-10 minutes for a first run (no caches yet)

### 8. Investigate any CI failures

If anything fails, read the job log carefully. The most likely failures and their fixes:

| Failure | Likely cause | Fix |
|---|---|---|
| `typecheck` red | Local typecheck wasn't actually run | Run `npm run typecheck` locally, fix errors, push |
| `build` red, "ENOENT .env" | Spec stubs in CI env block don't match what env.ts validates | Add the missing var to the workflow's `env:` block |
| `build` red, OOM | Heap size | `NODE_OPTIONS: --max-old-space-size=8192` (already set to 4096 — bump if needed) |
| `eval` red, "AIMock not reachable" | Service container didn't start in time | Bump health check retries in workflow |
| `eval` red, scorer schema validation | AIMock returns invalid scorer outputs | Confirm `eval.ts` skips scorers when `USE_AIMOCK=true` (per Phase 12 fix) |
| `docker` red, "no space left on device" | GitHub Actions disk filled | Add `docker system prune -af` step before build |

**If the failure is something else, document it in PROGRESS.md and stop.** Don't keep pushing band-aid commits to make CI green.

### 9. Tag a v0.1.0 release

Once CI is green:

```bash
git tag -a v0.1.0 -m "v0.1.0 — initial template, all 12 build phases + polish complete"
git push origin v0.1.0
```

This gives a stable reference point. When you later improve base, the children can rebase from a known-good version (`v0.1.0`) rather than `main`.

## What to capture in PROGRESS.md

```
## Polish 02: GitHub Publish & CI
- Status: complete | blocked
- Repo URL: https://github.com/<org>/template-mastra-base
- CI runs:
  - typecheck: ✓ <duration>
  - build: ✓ <duration>
  - eval: ✓ <duration>
  - docker: ✓ <duration>
- Tag: v0.1.0 pushed
- Notes: <CI quirks, time taken, anything unexpected>
```

## Stop after this step

Wait for owner approval before Polish 03. The provisioning test depends on the published repo URL.
