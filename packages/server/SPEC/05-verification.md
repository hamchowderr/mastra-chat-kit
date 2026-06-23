# 05 — Verification

End-to-end test plan. Run after the build is complete. Each step has a clear pass/fail criterion. Document failures in `PROGRESS.md`.

## Setup

You'll need:
- A real Supabase project (URL, anon key, service-role key, session pooler DB URL)
- A real Anthropic API key (for live tests)
- Docker installed (for Phase 9 verification)
- AIMock installable via `npx @copilotkit/aimock` (for AIMock tests)

Create a working `.env`:

```bash
cp .env.example .env
# Fill in:
# - APP_SECRET (openssl rand -hex 32)
# - All SUPABASE_* values
# - ANTHROPIC_API_KEY
# - MASTRA_TELEMETRY_DISABLED=1
```

## Tests in order

### 1. Typecheck

```bash
npm run typecheck
```

**Pass**: zero errors. Pure exit 0.

**Common failures**:
- Missing import → check Phase 6 wiring
- Type mismatch in scorer → check `_example.scorers.ts` against actual prebuilt scorer signatures in `node_modules/@mastra/evals/dist/scorers/`

### 2. Env loader fail-fast

Temporarily blank out `APP_SECRET` in `.env`, then:

```bash
npm run dev
```

**Pass**: process exits 1 with a Zod error pointing at `APP_SECRET`. No Mastra Studio loads.

Restore `APP_SECRET` and continue.

### 3. Mastra dev boot

```bash
npm run dev
```

**Pass criteria**:
- Mastra Studio loads at `http://localhost:4111`
- Console shows pretty-printed Pino logs
- `leadIntake` agent appears in Studio's agent list
- No errors in the console

**Common failures**:
- "Cannot find package" → typo in import or missing dep install
- "Connection refused" on Supabase → wrong `SUPABASE_DB_URL` (use the *session pooler* string, not the direct connection)
- Path alias error → confirm relative imports inside `src/mastra/`

### 4. Live agent smoke test (Studio)

In Studio, chat with `leadIntake`. Paste:

> Hi, this is John Smith from Acme Corp (john@acme.io). We need pricing for 50 seats by Friday.

**Pass criteria**:
- Agent returns a JSON response matching `LeadSchema`
- Fields populated: name="John Smith", email="john@acme.io", company="Acme Corp", intent="pricing", urgency="high"
- Trace view shows `validateEmail` tool was invoked
- No errors in console

**Cost**: ~$0.01

### 5. Live agent smoke test (cURL)

In a new terminal (Mastra still running):

```bash
curl -X POST http://localhost:4111/api/agents/leadIntake/generate \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "role": "user",
      "content": "URGENT - production down, losing money. Need help now."
    }]
  }'
```

**Pass criteria**:
- HTTP 200
- Response includes structured output with `intent: "support"`, `urgency: "high"`

**Cost**: ~$0.01

### 6. Health endpoint

```bash
curl http://localhost:4111/api/health
```

**Pass**: HTTP 200.

### 7. CI eval gate (live)

Stop dev server. Then with real Anthropic key:

```bash
npm run eval
```

**Pass criteria**:
- All 5 cases run
- Each case prints case name, scorer scores, pass/fail
- Aggregate summary at the end
- Exit 0 (or 1 with clear reasons if a scorer is below threshold)

**Cost**: ~$0.10 (5 cases × 3 LLM scorers each)

If a scorer is consistently below threshold, either:
- The threshold in the dataset JSON is too high (lower it)
- The scorer prompt needs refinement (look at the `urgencyScorer` analyze prompt)
- The agent's instructions need refinement

### 8. CI eval gate (AIMock)

In one terminal:

```bash
npx @copilotkit/aimock --port 4010
```

In another (still in project dir):

```bash
USE_AIMOCK=true AIMOCK_URL=http://localhost:4010 npm run eval
```

**Pass criteria**:
- Runs without making real API calls
- Deterministic output (same scores on repeat runs)
- Exit 0 or 1 based on AIMock fixtures

If AIMock isn't returning useful structured output, you may need to configure fixtures specifically for this agent. That's expected — AIMock by default returns simple acknowledgments. For a robust CI gate, define an `aimock.json` config with fixtures for each canonical input. Document this in `PROGRESS.md` as a follow-up.

### 9. Mastra build

```bash
npm run build
```

**Pass criteria**:
- Outputs `.mastra/output/index.mjs` and surrounding files
- Exit 0
- Bundle size reasonable (probably 5-50MB depending on deps)

**Common failures**:
- Heap out of memory → run with `NODE_OPTIONS=--max-old-space-size=4096 npm run build`
- Native dep error → confirm `gcompat` is installed in Dockerfile (this only matters in Docker)

### 10. Docker build

```bash
docker build -t template-mastra-base:test .
```

**Pass**: build succeeds. Image size < 400MB ideally (`docker images template-mastra-base:test`).

### 11. Docker run

```bash
docker compose up -d
sleep 10
curl http://localhost:4111/api/health
docker compose logs --tail=50 mastra
docker compose down
```

**Pass criteria**:
- `up -d` succeeds
- `/api/health` returns 200
- Logs are JSON (not pretty-printed) since NODE_ENV=production
- Logs show Mastra started without errors
- `down` cleans up

### 12. Onboarding flow

Final check: pretend you're a new dev. Open the README. Follow the 5-minute quickstart. The README should be sufficient — don't reference any other doc except by link.

**Pass**: from a clean clone, you can boot the example agent in under 5 minutes by reading only the README.

## Reporting

For each test that fails, write a clear note in `PROGRESS.md`:

```
## Verification failures

### Test 7: CI eval gate (live)
- Failed scorer: `urgency`
- Expected ≥ 0.8, got 0.6
- Cause: cases include "no rush" which the agent interprets as medium, not low
- Fix: refined the urgencyScorer judge prompt to be more lenient with "no rush" → "low"
- New result: 0.85 ✓
```

Document successful runs too — gives the owner confidence.
