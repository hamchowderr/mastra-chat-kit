# 03 — File Specifications

Each section below specifies one file. Implement them in the order given in `04-build-order.md`. Each spec includes purpose, code targets (or full code where the implementation is invariant), and acceptance criteria.

---

## `src/lib/env.ts`

**Purpose**: Zod-validated env loader. Crashes the process at boot if anything required is missing or invalid.

**Behavior**:
- Parses `process.env` against the schema below.
- On parse failure, prints a readable error listing every missing/invalid var and `process.exit(1)`.
- On success, exports the parsed values as a frozen object typed with TS inference.

**Required vars** (see `02-architecture.md` for the full table). Implementation:

```typescript
import { z } from 'zod';

const boolish = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 chars'),

    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_DB_URL: z
      .string()
      .url()
      .refine((v) => v.startsWith('postgres'), 'Must be a postgres:// connection string'),

    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

    USE_AIMOCK: boolish.default('false'),
    AIMOCK_URL: z.string().url().default('http://localhost:4010'),

    E2E_BASE_URL: z.string().url().optional(),

    MASTRA_TELEMETRY_DISABLED: z.string().optional(),
    MASTRA_CLOUD_ACCESS_TOKEN: z.string().optional(),
  })
  .refine(
    (e) => Boolean(e.ANTHROPIC_API_KEY || e.OPENAI_API_KEY || e.GOOGLE_GENERATIVE_AI_API_KEY),
    {
      message:
        'At least one LLM provider key required (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY)',
    },
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n');
  for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${(errors as string[]).join(', ')}`);
  }
  for (const err of parsed.error.flatten().formErrors) {
    console.error(`  ${err}`);
  }
  console.error('\nSee .env.example for the full list of required variables.');
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;
```

**Acceptance criteria**:
- `npm run typecheck` passes for this file.
- Importing `env` from a tsx script with empty env crashes with a clear error message.
- Importing `env` with valid env exposes typed values.

---

## `.env.example`

**Purpose**: Documents every env var; checked into source. Devs copy to `.env` and fill in.

```bash
# ──────────────────────────────────────────────
# App
# ──────────────────────────────────────────────
NODE_ENV=development
LOG_LEVEL=info
# Min 32 chars. Generate with: openssl rand -hex 32
APP_SECRET=

# ──────────────────────────────────────────────
# Supabase (required)
# ──────────────────────────────────────────────
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# Direct Postgres connection — used by @mastra/pg storage adapter.
# Supabase dashboard > Project Settings > Database > Connection string > URI (session pooler).
SUPABASE_DB_URL=

# ──────────────────────────────────────────────
# LLM providers (at least one required)
# ──────────────────────────────────────────────
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=

# ──────────────────────────────────────────────
# AIMock — deterministic LLM mocking
# Run: npx @copilotkit/aimock --config aimock.json
# ──────────────────────────────────────────────
USE_AIMOCK=false
AIMOCK_URL=http://localhost:4010

# ──────────────────────────────────────────────
# E2E (only used during e2e runs)
# ──────────────────────────────────────────────
E2E_BASE_URL=http://localhost:4111

# ──────────────────────────────────────────────
# Mastra
# ──────────────────────────────────────────────
# Recommended for locked-down corporate networks where PostHog is blocked
MASTRA_TELEMETRY_DISABLED=1
# Only set if connecting to hosted Mastra Studio
# MASTRA_CLOUD_ACCESS_TOKEN=
```

**Acceptance criteria**:
- File exists at repo root.
- A new dev can `cp .env.example .env`, fill in their Supabase values, paste a working Anthropic key, and `npm run dev` boots successfully.

---

## `src/mastra/lib/aimock.ts`

**Purpose**: When `env.USE_AIMOCK === true`, rewrites LLM provider base URLs (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, etc.) to point at the local AIMock server. Must run before any AI SDK client is constructed.

**Implementation**:

```typescript
import { env } from '../../lib/env';

/**
 * Routes LLM provider calls through AIMock when USE_AIMOCK=true.
 *
 * MUST be called before any Mastra agent or @ai-sdk/* client is constructed.
 * The Vercel AI SDK reads provider base URLs from env at client instantiation
 * and caches them — late overrides will silently hit the real APIs.
 *
 * Idempotent. Safe to call multiple times.
 */
export function configureAIMock(): void {
  if (!env.USE_AIMOCK) return;

  const base = env.AIMOCK_URL.replace(/\/$/, '');

  // OpenAI
  process.env.OPENAI_BASE_URL = `${base}/v1`;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'mock';

  // Anthropic
  process.env.ANTHROPIC_BASE_URL = base;
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'mock';

  // Google Gemini
  process.env.GOOGLE_GENERATIVE_AI_BASE_URL = base;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? 'mock';

  if (env.LOG_LEVEL === 'debug') {
    console.log(`🎭 AIMock active — LLM calls routed to ${base}`);
  }
}
```

**Acceptance criteria**:
- Import + call `configureAIMock()` with `USE_AIMOCK=false` is a no-op (no env vars touched).
- With `USE_AIMOCK=true`, `process.env.OPENAI_BASE_URL` etc. are set immediately on call.
- Calling twice doesn't double-prefix or otherwise corrupt URLs.

---

## `src/mastra/lib/supabase.ts`

**Purpose**: Centralized Supabase client factory. Three named functions so intent is obvious at call sites.

**Dependency**: requires `@supabase/supabase-js` to be installed.

**Implementation**:

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../lib/env';

let anonClient: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;

/**
 * Anon Supabase client — respects Row-Level Security policies.
 *
 * Use this when the agent acts on behalf of a user and you want
 * RLS to enforce who can read/write what.
 */
export function getSupabaseAnon(): SupabaseClient {
  if (!anonClient) {
    anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return anonClient;
}

/**
 * Service-role Supabase client — bypasses Row-Level Security.
 *
 * Use for system-level operations: background jobs, admin tooling,
 * ingestion pipelines. NEVER expose this client or its results
 * directly to a user-controlled context.
 */
export function getSupabaseService(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

/**
 * Returns an anon client scoped to a specific user's JWT.
 * RLS evaluates as that user, not as the anon role.
 */
export function getSupabaseForUser(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
```

**Acceptance criteria**:
- Typecheck passes.
- Anon and service-role clients are cached singletons (returning the same instance on repeated calls).
- `getSupabaseForUser` returns a fresh client per call (different JWTs must not share clients).

---

## `src/mastra/lib/processors.ts`

**Purpose**: One shared input/output processor baseline every agent spreads in, so the whole fleet has the same safety/hygiene layer instead of each agent reinventing it.

**Design rule (do not relitigate)**: only the two **deterministic, no-LLM** processors are active by default — `UnicodeNormalizer` (input) and `TokenLimiter` (output). The five model-backed safety processors (`ModerationProcessor`, `PromptInjectionDetector`, `PIIDetector`, `LanguageDetector`, `SystemPromptScrubber`) each construct their own agent and make their own LLM call; enabling all of them turns one request into ~6 sequential LLM calls. They — plus behavior-changing ones (`ToolCallFilter`, `StructuredOutputProcessor`, `BatchPartsProcessor`) — ship **present-but-commented** as opt-in, with a one-line rationale each. Do not enable them by default.

**Implementation**:

```typescript
import type { InputProcessorOrWorkflow, OutputProcessorOrWorkflow } from '@mastra/core/processors';
import { UnicodeNormalizer, TokenLimiter } from '@mastra/core/processors';

export const DEFAULT_OUTPUT_TOKEN_LIMIT = 8000;

export const defaultInputProcessors: InputProcessorOrWorkflow[] = [
  new UnicodeNormalizer({ stripControlChars: true, collapseWhitespace: true }),
  // OPT-IN (each = one extra LLM call), uncomment + add a model to enable:
  // new PromptInjectionDetector({ model: 'anthropic/claude-haiku-4-5' }),
  // new ModerationProcessor({ model: 'anthropic/claude-haiku-4-5' }),
  // new PIIDetector({ model: 'anthropic/claude-haiku-4-5', strategy: 'redact' }),
];

export const defaultOutputProcessors: OutputProcessorOrWorkflow[] = [
  new TokenLimiter({ limit: DEFAULT_OUTPUT_TOKEN_LIMIT, strategy: 'truncate' }),
  // OPT-IN:
  // new SystemPromptScrubber({ model: 'anthropic/claude-haiku-4-5' }),
  // new ToolCallFilter({ exclude: [] }),
];
```

(See the actual file for the full commented opt-in list and the file-header rationale.)

**Acceptance criteria**:
- Typecheck passes; both arrays export with the correct `InputProcessorOrWorkflow[]` / `OutputProcessorOrWorkflow[]` types.
- Only `UnicodeNormalizer` and `TokenLimiter` are active; everything else is commented.
- These are NOT memory processors — adding them does not suppress Mastra's auto-added `MessageHistory` / `WorkingMemory` processors.

---

## `src/mastra/lib/memory.ts`

**Purpose**: One shared `Memory` factory so every agent that has memory uses the same policy.

**Design rule (do not relitigate)**: working memory **ON**, `scope: 'resource'` (persists per user across threads). Semantic recall **OFF** — it adds an embed + vector-query per turn and needs a `vector` store + `embedder` this template doesn't configure. Pass no `storage` — Memory inherits the Mastra instance's `PostgresStore` (Supabase), which supports the `mastra_resources` table resource-scoping requires.

**Implementation**:

```typescript
import { Memory } from '@mastra/memory';

export const DEFAULT_WORKING_MEMORY_TEMPLATE = `# User Profile

## Identity
- Name:
- Role / Company:

## Preferences
- Communication style: [e.g., concise, detailed]
- Constraints / things to avoid:

## Session State
- Current goal:
- Open items:
`;

export function createDefaultMemory(
  template: string = DEFAULT_WORKING_MEMORY_TEMPLATE,
): Memory {
  return new Memory({
    options: {
      workingMemory: { enabled: true, scope: 'resource', template },
      // semanticRecall: intentionally off
    },
  });
}
```

**Acceptance criteria**:
- Typecheck passes.
- Agents use `memory: createDefaultMemory()` (NOT bare `new Memory()`).
- Working memory only persists per user when the caller passes `memory: { thread, resource }` — document this contract in `README.md`.

---

## `src/mastra/index.ts`

**Purpose**: Mastra entry point. Strict boot order; replaces the scaffolded version.

**Implementation**: see `02-architecture.md` § Boot order. Use that exact code, with one note: top-level `await` for `DuckDBStore().getStore('observability')` requires `"module": "ES2022"` in tsconfig (already set).

**Acceptance criteria**:
- `npm run dev` starts Mastra Studio at `localhost:4111` without errors.
- Studio shows the `leadIntake` agent registered.
- Boot order validated: a misconfigured `.env` crashes before any LLM provider client is constructed.
- `console.log` shows pretty-printed Pino output in dev (`LOG_LEVEL=debug`).

---

## `src/mastra/agents/_example.ts`

**Purpose**: Canonical lead-intake agent. Demonstrates every convention. New agents copy this file as a starting template.

**Behavior**:
- Takes unstructured text (email body, voice transcript, form submission).
- Returns `LeadSchema`-shaped structured output.
- Uses one inline tool (`validateEmail`).
- Registers three scorers with continuous sampling.

**Implementation**:

```typescript
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  hallucinationScorer,
  completenessScorer,
  urgencyScorer,
} from '../scorers/_example.scorers';
import { createDefaultMemory } from '../lib/memory';
import { defaultInputProcessors, defaultOutputProcessors } from '../lib/processors';

/**
 * # Lead Intake Agent (canonical example)
 *
 * What it does:
 *   Takes unstructured text (email body, voice transcript, form submission)
 *   and returns structured lead data validated against LeadSchema.
 *
 * Who calls it:
 *   - n8n / Make webhook
 *   - Next.js API route
 *   - VAPI/LiveKit tool callback
 *   Endpoint: POST /api/agents/leadIntake/generate
 *
 * Env vars required:
 *   - ANTHROPIC_API_KEY (default model)
 *
 * How to test:
 *   curl -X POST http://localhost:4111/api/agents/leadIntake/generate \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "messages": [{
 *         "role": "user",
 *         "content": "Hi, this is John from Acme Corp (john@acme.io). We need pricing for 50 seats by Friday."
 *       }]
 *     }'
 *
 * Copy this file, rename, and adapt for new agents.
 */

export const LeadSchema = z.object({
  name: z.string().nullable().describe('Full name of the lead, or null if not found'),
  email: z.string().email().nullable().describe('Email address, or null'),
  company: z.string().nullable().describe('Company name, or null'),
  intent: z
    .enum(['demo', 'pricing', 'support', 'partnership', 'other'])
    .describe('What the lead wants'),
  urgency: z.enum(['low', 'medium', 'high']).describe('Tone-based urgency'),
  notes: z.string().describe('One-sentence summary of context'),
});

export type Lead = z.infer<typeof LeadSchema>;

const validateEmail = createTool({
  id: 'validateEmail',
  description: 'Validate and normalize an email address',
  inputSchema: z.object({ email: z.string() }),
  outputSchema: z.object({
    valid: z.boolean(),
    normalized: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  execute: async ({ context }) => {
    const result = z.string().email().safeParse(context.email.trim().toLowerCase());
    if (!result.success) {
      return {
        valid: false,
        normalized: null,
        reason: result.error.issues[0]?.message ?? 'Invalid email format',
      };
    }
    return { valid: true, normalized: result.data, reason: null };
  },
});

export const leadIntakeAgent = new Agent({
  id: 'leadIntake',
  name: 'Lead Intake',
  instructions: `You extract structured lead information from unstructured text.

Inputs may be email bodies, voice transcripts, or form submissions.

Rules:
- If a field is not present, return null. Never guess or fabricate.
- When you find an email address, call validateEmail to confirm it parses cleanly.
- The notes field is one short sentence summarizing what the lead actually wants.
- Urgency reflects tone: explicit deadlines or frustration → high; "would love to learn more" → low; default → medium.

Return only the structured output — no preamble, no commentary.`,
  model: 'anthropic/claude-sonnet-4-6',
  tools: { validateEmail },
  memory: createDefaultMemory(),
  inputProcessors: defaultInputProcessors,
  outputProcessors: defaultOutputProcessors,
  scorers: {
    hallucination: {
      scorer: hallucinationScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    completeness: {
      scorer: completenessScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    urgency: {
      scorer: urgencyScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
});
```

**Acceptance criteria**:
- Agent registers without errors.
- Live smoke test (real Anthropic key) returns valid `LeadSchema` output for the canonical input.
- Studio shows the agent and lets you chat with it.
- The `validateEmail` tool is invoked when an email is present in input.

---

## `src/mastra/scorers/_example.scorers.ts`

**Purpose**: Three scorers for the lead-intake agent. Two prebuilt, one custom.

**Behavior**:
- `hallucinationScorer`: prebuilt LLM-judged scorer that detects fabricated content
- `completenessScorer`: prebuilt code-based scorer; checks if output covers the input requirements
- `urgencyScorer`: custom scorer (built with `createScorer`) that asserts urgency was inferred correctly

**Implementation guidance**:
- Look up the exact API for `createHallucinationScorer` in `node_modules/@mastra/evals/dist/scorers/llm/hallucination/index.d.ts` before writing — the signature may have specific options.
- Same for `createCompletenessScorer` in `node_modules/@mastra/evals/dist/scorers/code/completeness/index.d.ts`.
- For the custom `urgencyScorer`, use `createScorer` from `@mastra/core/evals` with `.preprocess() → .analyze() → .generateScore() → .generateReason()` chain. Reference `src/mastra/scorers/weather-scorer.ts` from the original scaffold (before deletion) for the pattern. *(Note: it was deleted in build order — if you need the reference, recover from git or re-scaffold a throwaway project to inspect.)*

**Sketch** (verify against actual package types before finalizing):

```typescript
import { createHallucinationScorer } from '@mastra/evals/scorers/llm';
import { createCompletenessScorer } from '@mastra/evals/scorers/code';
import { createScorer } from '@mastra/core/evals';
import { getUserMessageFromRunInput, getAssistantMessageFromRunOutput } from '@mastra/evals/scorers/utils';
import { z } from 'zod';

export const hallucinationScorer = createHallucinationScorer({
  model: 'anthropic/claude-sonnet-4-6',
  // ... refer to actual prebuilt scorer signature
});

export const completenessScorer = createCompletenessScorer();

export const urgencyScorer = createScorer({
  id: 'lead-urgency-scorer',
  name: 'Lead Urgency',
  description: 'Verifies the agent inferred urgency level correctly from tone',
  type: 'agent',
  judge: {
    model: 'anthropic/claude-sonnet-4-6',
    instructions:
      'You evaluate whether an AI agent correctly inferred urgency from the tone of a lead message. ' +
      'High urgency = explicit deadline, frustration, "URGENT", "production down", "now", etc. ' +
      'Low urgency = casual phrasing, "no rush", "curious", exploratory tone. ' +
      'Medium = default; neither explicit urgency nor explicit casual.',
  },
})
  .preprocess(({ run }) => {
    const userText = getUserMessageFromRunInput(run.input) || '';
    const assistantText = getAssistantMessageFromRunOutput(run.output) || '';
    return { userText, assistantText };
  })
  .analyze({
    description: 'Determine if urgency in output matches urgency in input tone',
    outputSchema: z.object({
      expectedUrgency: z.enum(['low', 'medium', 'high']),
      reportedUrgency: z.enum(['low', 'medium', 'high']),
      match: z.boolean(),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => `
Evaluate urgency inference.

User message:
"""
${results.preprocessStepResult.userText}
"""

Agent response (JSON):
"""
${results.preprocessStepResult.assistantText}
"""

Tasks:
1. Determine the correct urgency from the user's tone.
2. Extract what urgency the agent reported (look for "urgency": "..." in the JSON).
3. Set match=true only if they agree.

Return JSON: { expectedUrgency, reportedUrgency, match, explanation }
`,
  })
  .generateScore(({ results }) => {
    const r = (results as { analyzeStepResult?: { match?: boolean } }).analyzeStepResult;
    return r?.match ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r = (results as { analyzeStepResult?: { expectedUrgency?: string; reportedUrgency?: string; explanation?: string } }).analyzeStepResult ?? {};
    return `Expected: ${r.expectedUrgency ?? '?'}, Reported: ${r.reportedUrgency ?? '?'}. Score=${score}. ${r.explanation ?? ''}`;
  });
```

**Acceptance criteria**:
- Typecheck passes.
- All three scorers exportable.
- Each can be passed to an agent's `scorers` config.

---

## `src/mastra/scorers/datasets/_example.json`

**Purpose**: Canonical inputs + expected behavior for offline CI gate. The eval runner loads this, invokes the agent on each input, applies scorers, and asserts thresholds.

**Schema**:

```json
{
  "agentId": "leadIntake",
  "thresholds": {
    "hallucination": 0.85,
    "completeness": 0.7,
    "urgency": 0.8
  },
  "cases": [
    {
      "name": "extracts all fields from clean intro",
      "input": "Hi, this is John Smith from Acme Corp (john@acme.io). We need pricing for 50 seats by Friday.",
      "expectedFields": {
        "name": "John Smith",
        "email": "john@acme.io",
        "company": "Acme Corp",
        "intent": "pricing",
        "urgency": "high"
      }
    },
    {
      "name": "returns null for missing fields",
      "input": "Looking for a demo of your platform.",
      "expectedFields": {
        "name": null,
        "email": null,
        "company": null,
        "intent": "demo"
      }
    },
    {
      "name": "detects high urgency from frustration",
      "input": "URGENT — production is down and we're losing money. Need help now.",
      "expectedFields": {
        "intent": "support",
        "urgency": "high"
      }
    },
    {
      "name": "low urgency for casual tone",
      "input": "Hey, just curious about partnership opportunities. No rush.",
      "expectedFields": {
        "intent": "partnership",
        "urgency": "low"
      }
    },
    {
      "name": "anti-hallucination: never fabricates missing email",
      "input": "Hi, I am Jane and I want a demo.",
      "expectedFields": {
        "email": null
      }
    }
  ]
}
```

**Acceptance criteria**:
- Valid JSON, lints clean.
- Eval runner consumes it without schema errors.
- 5 cases minimum; at least 1 anti-hallucination case.

---

## `scripts/eval.ts`

**Purpose**: Offline CI gate. Loads dataset, runs agent on each input, runs scorers, asserts thresholds, exits with code 0 (all pass) or 1 (any fail).

**Behavior**:
- Reads dataset JSON from `src/mastra/scorers/datasets/_example.json` (or accepts a path arg).
- Loads `mastra` from `src/mastra/index.ts`.
- For each case: invokes `mastra.getAgent(agentId).generate(input, { structuredOutput: { schema: LeadSchema } })`.
- Validates structured output against `expectedFields` (deep partial equality).
- Aggregates per-scorer averages — note that the scorers attached to the agent run automatically; the runner observes those scores from the agent's run output (or runs them manually if direct programmatic access isn't simple).
- Compares averages against thresholds.
- Prints a colored summary; exits 0 if all thresholds met, 1 otherwise.

**Implementation guidance**:
- This is the most novel piece. Read `node_modules/@mastra/core/dist/agent/index.d.ts` for the `generate` API and how scorer results surface in the response.
- If scorer results aren't directly returned from `generate`, run scorers manually by importing them from `_example.scorers.ts` and calling them with `{ input, output, ... }` per their interface.
- Use `tsx` to run (`npx tsx scripts/eval.ts`).

**Acceptance criteria**:
- `npm run eval` (script you'll add to package.json) executes without runtime errors when `USE_AIMOCK=true` and AIMock is running.
- Exits 0 when all scorers ≥ thresholds.
- Exits 1 when any scorer < threshold.
- Prints case-by-case results AND aggregate summary.

---

## `package.json` updates

Add these scripts:

```json
{
  "scripts": {
    "dev": "mastra dev",
    "build": "mastra build",
    "start": "mastra start",
    "typecheck": "tsc --noEmit",
    "eval": "tsx scripts/eval.ts",
    "score:list": "mastra scorers list"
  }
}
```

Move `tsx` to devDependencies if it isn't already.

---

## `Dockerfile`

**Purpose**: Multi-stage build producing a small production image. Based on Mastra's official AWS Lambda Dockerfile reference.

**Implementation** (use this verbatim unless build fails):

```dockerfile
# syntax=docker/dockerfile:1.7

# ─── Stage 1: build ───────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx mastra build

# ─── Stage 2: runtime ─────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# gcompat — required by Mastra docs for native dep compatibility on Alpine
# tini — proper signal handling for SIGTERM
RUN apk add --no-cache gcompat tini

RUN addgroup -g 1001 -S nodejs && \
    adduser -S mastra -u 1001 && \
    chown -R mastra:nodejs /app

ENV NODE_ENV=production
ENV PORT=4111

COPY --from=build --chown=mastra:nodejs /app/.mastra/output ./.mastra/output

USER mastra
EXPOSE 4111

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4111/api/health > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".mastra/output/index.mjs"]
```

**Acceptance criteria**:
- `docker build .` succeeds.
- `docker compose up -d` starts a healthy container.
- `curl http://localhost:4111/api/health` returns 200.
- Image size < 400MB.

---

## `.dockerignore`

```
node_modules
.git
.gitignore
.env
.env.local
.env.*.local
.mastra
dist
build
coverage
.next
*.log
.DS_Store
.vscode
.idea
README.md
SPEC
```

---

## `docker-compose.yml`

```yaml
services:
  mastra:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: mastra
    restart: unless-stopped
    ports:
      - "4111:4111"
    env_file:
      - .env
    environment:
      - NODE_ENV=production
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '1.0'
        reservations:
          memory: 256M
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4111/api/health"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

---

## `compose.dev.yml`

```yaml
services:
  mastra:
    build:
      target: build
    command: ["npx", "mastra", "dev"]
    volumes:
      - ./src:/app/src:ro
    environment:
      - NODE_ENV=development
```

---

## `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck

  build:
    runs-on: ubuntu-latest
    needs: typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: Mastra build
        run: npm run build
        env:
          NODE_OPTIONS: --max-old-space-size=4096
          MASTRA_TELEMETRY_DISABLED: '1'
          APP_SECRET: ${{ secrets.CI_APP_SECRET }}
          SUPABASE_URL: https://stub.supabase.co
          SUPABASE_ANON_KEY: stub
          SUPABASE_SERVICE_ROLE_KEY: stub
          SUPABASE_DB_URL: postgres://stub:stub@localhost:5432/stub
          ANTHROPIC_API_KEY: stub

  eval:
    runs-on: ubuntu-latest
    needs: typecheck
    services:
      aimock:
        image: ghcr.io/copilotkit/aimock:latest
        ports:
          - 4010:4010
        options: >-
          --health-cmd "wget -qO- http://localhost:4010/health || exit 1"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: Run eval gate
        run: npm run eval
        env:
          USE_AIMOCK: 'true'
          AIMOCK_URL: http://localhost:4010
          MASTRA_TELEMETRY_DISABLED: '1'
          APP_SECRET: ${{ secrets.CI_APP_SECRET }}
          SUPABASE_URL: https://stub.supabase.co
          SUPABASE_ANON_KEY: stub
          SUPABASE_SERVICE_ROLE_KEY: stub
          SUPABASE_DB_URL: postgres://stub:stub@localhost:5432/stub
          ANTHROPIC_API_KEY: stub
          OPENAI_API_KEY: stub
          GOOGLE_GENERATIVE_AI_API_KEY: stub
          NODE_ENV: test
          LOG_LEVEL: warn

  docker:
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
          tags: mastra:ci-${{ github.sha }}
```

**Required GitHub secret**: `CI_APP_SECRET` — generate with `openssl rand -hex 32`.

---

## `README.md`, `AGENTS.md`, `prompts/build-agent.md`, `prompts/README.md`

These are documentation files. The verbatim content was discussed in the conversation transcript; if you (the agent) don't have access to that transcript, ask the owner or reconstruct from these spec files. Key points:

- **README.md**: human onboarding. Quickstart in 5 minutes at the top. File-tree comments. Common gotchas section. Reference to AGENTS.md.
- **AGENTS.md**: project conventions for AI agents. Boot order, import rules (relative inside `src/mastra/`), env var protocol (Zod schema + .env.example together), naming, "things to never do," "ask before acting."
- **prompts/build-agent.md**: parameterized agent-build prompt. Inputs at top, conventions, deliverables, constraints, implementation order.
- **prompts/README.md**: index of prompts and the planned future ones (build-tool, build-scorer, build-workflow, deploy-vps, client-kickoff, debug-agent).
