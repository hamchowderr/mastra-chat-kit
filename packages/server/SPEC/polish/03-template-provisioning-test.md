# Polish 03 — Template Provisioning Test

This is the most important polish step. Everything we've built is for nothing if `npx create-mastra --template <our-repo>` doesn't actually work as a starting point for a new project.

## What this proves

The owner's business model is:
1. Build template-mastra-base
2. When a client signs, run a provisioning command that scaffolds a project from the template
3. Customize for the client, ship

If step 2 doesn't work, the template is just a code archive, not a template.

## Steps

### 1. Pick a scratch location for the test project

Don't put it under `C:\Users\HamCh\code\` where the original lives — too easy to confuse. Use a temp folder:

```bash
mkdir C:\Users\HamCh\Downloads\template-test
cd C:\Users\HamCh\Downloads\template-test
```

### 2. Provision via the CLI

This is the actual command the owner will run for new clients:

```bash
npx create-mastra@latest test-client-001 \
  --template <org>/template-mastra-base \
  --default \
  --llm anthropic \
  --llm-api-key dummy-replace-me \
  --timeout 300000
```

Replace `<org>` with the GitHub org/username from Polish 02.

**Pass criteria:**
- Command completes without error
- A `test-client-001/` folder is created
- Folder contains the same structure as our base template (SPEC/, src/, Dockerfile, etc.)

**Watch for:**
- Whether the CLI clones the repo cleanly (it uses `degit` under the hood)
- Whether `npm install` runs automatically and succeeds
- Any prompts that appear despite `--default` (the CLI sometimes still asks about MCP server setup)

### 3. Verify the provisioned project structure

```bash
cd test-client-001
ls -la
ls SPEC
ls src/mastra
```

**Pass criteria:**
- All the files from base are present
- `SPEC/PROGRESS.md` from the base build IS present (template includes it as a record)
- `SPEC/polish/` IS present
- `node_modules/` exists (CLI auto-installed) OR you'll need to run `npm install`
- `.env` does NOT exist (good — sensitive, shouldn't propagate)
- `.env.example` IS present
- `.git/` should NOT exist OR should be a fresh repo (CLI uses degit, history is dropped — which is correct)

### 4. Configure the test project's env

```bash
cp .env.example .env
```

Fill in `.env` with the SAME values the base template uses (it's a test, not a real client):
- `APP_SECRET` — generate fresh: `openssl rand -hex 32`
- `SUPABASE_*` — same values from base template's `.env`
- `ANTHROPIC_API_KEY` — same
- `MASTRA_TELEMETRY_DISABLED=1`

The owner can copy from the original `.env` for speed:

```bash
cp C:\Users\HamCh\code\template-mastra-base\.env .env
# Then edit APP_SECRET to a new random value
```

### 5. Boot it

```bash
npm install   # if CLI didn't already
npm run dev
```

**Pass criteria:**
- Mastra Studio loads at http://localhost:4111
- `leadIntake` agent is visible
- A canonical input returns valid output (same as Polish 01 step 4)

### 6. Run typecheck and eval

```bash
npm run typecheck
npm run eval
```

**Pass criteria:**
- typecheck exits 0
- eval exits 0 (using live Anthropic key — costs ~$0.10)

### 7. Test that customization works

This is the real point — a client project SHOULD be modifiable without breaking. Add a trivial new agent to verify:

```bash
cp src/mastra/agents/_example.ts src/mastra/agents/test-agent.ts
```

Edit `src/mastra/agents/test-agent.ts`:
- Change `id: 'leadIntake'` → `id: 'testAgent'`
- Change `name: 'Lead Intake'` → `name: 'Test Agent'`
- Remove the scorer registrations (so we don't need to also add scorer file)

Edit `src/mastra/index.ts`:
- Add: `import { leadIntakeAgent as testAgent } from './agents/test-agent';` (or rename the export and import properly)
- Wait — easier: just don't import scorers in test-agent.ts, and import the agent properly

(Use your judgement on the cleanest minimal addition. The point is to verify "I can extend this template without rewriting it.")

```bash
npm run typecheck
npm run dev
```

**Pass criteria:**
- typecheck still passes
- Studio shows BOTH `leadIntake` and `testAgent`
- New agent responds to messages

### 8. Clean up

```bash
cd ..
rm -rf test-client-001
```

(Don't delete the GitHub repo or anything in `C:\Users\HamCh\code\`. Just the scratch folder.)

## What to capture in PROGRESS.md

```
## Polish 03: Provisioning Test
- Status: complete | blocked
- Provisioning command: <exact command run>
- Project boot: pass | fail
- typecheck: pass | fail
- eval: pass | fail
- Customization (new agent added): pass | fail
- Notes: <any quirks; e.g. "CLI prompted for MCP setup despite --default", "had to npm install manually">
- Provisioning time end-to-end: <minutes>
```

## What this test reveals

**If it passes:** the template is genuinely reusable. New client projects are 5 minutes from "git clone" to "running agent." This is the workflow that makes the consulting business scale.

**If it fails:** something about the template structure breaks under degit. Likely culprits:
- A file in the template has hardcoded paths that assume the project is at a specific location
- The CLI's degit version doesn't handle subdirectories (`SPEC/polish/` was newly created — verify it survives)
- Some path resolution in env.ts or eval.ts breaks when the project name changes

## Stop after this step

Most important gate of the whole polish phase. If this fails, the template is broken even if everything else passes. Wait for owner review.
