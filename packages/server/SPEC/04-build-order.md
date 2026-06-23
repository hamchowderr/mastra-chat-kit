# 04 — Build Order

Strict order. Each phase has a verification checkpoint. Don't proceed past a failing checkpoint without flagging in `PROGRESS.md`.

## Phase 0: Prep

1. Read all SPEC files in order.
2. Verify Node 22+ is available: `node --version`.
3. Verify the scaffolded project is intact: `ls src/mastra/` shows `agents/`, `index.ts`, `scorers/`, `tools/`, `workflows/`.

**Checkpoint**: If anything looks unexpected, stop and report.

## Phase 1: Strip the weather example

1. Delete:
   - `src/mastra/agents/weather-agent.ts`
   - `src/mastra/tools/weather-tool.ts`
   - `src/mastra/workflows/weather-workflow.ts`
   - `src/mastra/scorers/weather-scorer.ts`
2. Replace `src/mastra/index.ts` content with a minimal placeholder so the project still parses (you'll fully rewrite it in Phase 4):

```typescript
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';

export const mastra = new Mastra({
  storage: new LibSQLStore({ url: 'file:./mastra.db' }),
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
});
```

**Checkpoint**: `npm run typecheck` passes (zero errors).

## Phase 2: Install additional dependencies

```bash
npm install @mastra/pg @supabase/supabase-js
npm install --save-dev tsx
```

**Checkpoint**: `npm list @mastra/pg @supabase/supabase-js tsx` shows all three. No peer dependency warnings beyond what's expected.

## Phase 3: Env loader + AIMock + Supabase factory

In order:

1. Write `src/lib/env.ts` per spec.
2. Write `.env.example` per spec.
3. Write `src/mastra/lib/aimock.ts` per spec.
4. Write `src/mastra/lib/supabase.ts` per spec.
5. Write `src/mastra/lib/processors.ts` per spec (UnicodeNormalizer + TokenLimiter active; rest commented).
6. Write `src/mastra/lib/memory.ts` per spec (`createDefaultMemory()`, working memory on, recall off).

**Checkpoint**: `npm run typecheck` passes. No file at `src/mastra/lib/logger.ts` — that was removed from the plan.

## Phase 4: Rewrite Mastra entry point

1. Replace `src/mastra/index.ts` with the full version per spec (`02-architecture.md` § Boot order).
   - **Use `LibSQLStore` for the default domain TEMPORARILY** while the agent and scorer files don't yet exist. We swap to `PostgresStore` from `@mastra/pg` in Phase 7 once everything compiles.
   - Comment out the `agents` and `scorers` registrations until those files exist.

```typescript
// 1. Env validation FIRST
import { env } from '../lib/env';

// 2. AIMock provider switch
import { configureAIMock } from './lib/aimock';
configureAIMock();

// 3. Mastra
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql'; // temporary, swap in Phase 7
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, DefaultExporter, SensitiveDataFilter } from '@mastra/observability';

export const mastra = new Mastra({
  // agents and scorers registered in Phase 6 once they exist
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({ url: 'file:./mastra.db' }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  logger: new PinoLogger({ name: 'Mastra', level: env.LOG_LEVEL }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new DefaultExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
```

**Checkpoint**:
1. `npm run typecheck` passes.
2. Create a temporary `.env` with stub Supabase values + a real Anthropic key, then `npm run dev`. Expected: Mastra Studio loads at `localhost:4111`. No agents listed yet.
3. If env vars are missing, you should see the Zod error message and process exit 1.

## Phase 5: Scorers

1. Inspect `node_modules/@mastra/evals/dist/scorers/` to learn the actual prebuilt scorer signatures.
2. Write `src/mastra/scorers/_example.scorers.ts` per spec.

**Checkpoint**: `npm run typecheck` passes.

## Phase 6: Example agent

1. Write `src/mastra/agents/_example.ts` per spec — including `memory: createDefaultMemory()` and the shared `inputProcessors` / `outputProcessors` from `lib/`.
2. Update `src/mastra/index.ts` to import and register the agent and scorers (uncomment from Phase 4).

**Checkpoint**:
1. `npm run typecheck` passes.
2. `npm run dev` boots; Studio shows `leadIntake` agent.
3. **Live smoke test**: chat with the agent in Studio (real Anthropic key). Send: "Hi, this is John from Acme Corp (john@acme.io). We need pricing for 50 seats by Friday." Expected: structured output matching LeadSchema, validateEmail tool invoked.
4. cURL test:
   ```bash
   curl -X POST http://localhost:4111/api/agents/leadIntake/generate \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"Hi, this is John from Acme Corp (john@acme.io). We need pricing for 50 seats by Friday."}]}'
   ```

## Phase 7: Swap LibSQL → @mastra/pg

1. In `src/mastra/index.ts`, replace `import { LibSQLStore } from '@mastra/libsql'` with `import { PostgresStore } from '@mastra/pg'`.
2. Replace `default: new LibSQLStore({ url: 'file:./mastra.db' })` with `default: new PostgresStore({ connectionString: env.SUPABASE_DB_URL })`.
3. Optionally remove `@mastra/libsql` from `dependencies` if nothing else uses it (`npm uninstall @mastra/libsql`).

**Checkpoint**: With a real `SUPABASE_DB_URL`, `npm run dev` boots and the agent still works. Memory threads now persist to Supabase Postgres.

## Phase 8: CI eval runner

1. Write `src/mastra/scorers/datasets/_example.json` per spec.
2. Write `scripts/eval.ts` per spec.
3. Add `eval` script to `package.json`.

**Checkpoint**:
1. `npm run typecheck` passes.
2. With `USE_AIMOCK=false` and a real Anthropic key, `npm run eval` runs all 5 cases against the live agent and exits 0 (or 1 with reasons if scores are below threshold).
3. With AIMock running locally and `USE_AIMOCK=true`, `npm run eval` runs deterministically against fixtures.

## Phase 9: Docker

1. Write `Dockerfile` per spec.
2. Write `.dockerignore` per spec.
3. Write `docker-compose.yml` per spec.
4. Write `compose.dev.yml` per spec.

**Checkpoint**:
1. `docker build -t template-mastra-base:test .` succeeds.
2. `docker compose up -d` starts a healthy container.
3. `curl http://localhost:4111/api/health` returns 200.
4. `docker compose down` cleans up.

## Phase 10: CI workflow

1. Write `.github/workflows/ci.yml` per spec.

**Checkpoint**: This phase is verified at PR-time, not locally. Note in PROGRESS.md that the workflow needs a real `CI_APP_SECRET` GitHub secret set.

## Phase 11: Documentation

1. Write `README.md` per spec.
2. Write `AGENTS.md` per spec.
3. Optional: symlink `CLAUDE.md` to `AGENTS.md` for Claude Code users.
4. Write `prompts/README.md` per spec.
5. Write `prompts/build-agent.md` per spec.

**Checkpoint**: A new dev who's never seen this template can `cp .env.example .env`, fill in values, run `npm run dev`, and chat with the example agent — entirely from following README.

## Phase 12: Final verification

Run through `05-verification.md` end-to-end. Document any failures in `PROGRESS.md`.
