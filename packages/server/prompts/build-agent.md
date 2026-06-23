# Prompt: Build a New Mastra Agent

Use this prompt to add a complete, production-ready agent to this template.

---

## Inputs (fill these in before using the prompt)

```
AGENT_NAME:        <kebab-case name, e.g. "invoice-parser">
AGENT_ID:          <camelCase id used in API routes, e.g. "invoiceParser">
PURPOSE:           <one sentence: what the agent does and what calls it>
INPUT_FORMAT:      <what the agent receives: email body / voice transcript / webhook payload / etc.>
OUTPUT_SCHEMA:     <describe the fields: name, type, nullable?, description>
TOOLS:             <list inline tools the agent needs, or "none">
MODEL:             <default: anthropic/claude-sonnet-4-6>
EVAL_CASES:        <describe 4-5 test cases: one happy path, one missing-fields, one edge case, one anti-hallucination>
```

---

## Prompt

You are adding a new agent to the `template-mastra-base` Mastra project. Follow every convention in `AGENTS.md` exactly.

**Agent to build**: `{AGENT_NAME}` (`{AGENT_ID}`)

**Purpose**: {PURPOSE}

**Input**: {INPUT_FORMAT}

**Output schema**: {OUTPUT_SCHEMA}

**Tools needed**: {TOOLS}

**Model**: {MODEL}

---

### Deliverables

Produce these files and changes in order:

1. **`src/mastra/agents/{AGENT_NAME}.ts`**
   - Export a named Zod schema (`{PascalCase}Schema`) and its inferred type
   - Export the agent as `{camelCase}Agent` with `id: '{AGENT_ID}'`
   - Include `instructions` that are specific and grounded (no vague "you are a helpful assistant")
   - Register these scorers with `sampling: { type: 'ratio', rate: 1 }`:
     - `hallucination` (prebuilt)
     - `completeness` (prebuilt)
     - One custom scorer relevant to this agent's domain (use `createScorer`)
   - Include a Memory instance
   - Add a JSDoc block at the top: what it does, who calls it, env vars required, example curl

2. **`src/mastra/scorers/{AGENT_NAME}.scorers.ts`**
   - Export `hallucinationScorer`, `completenessScorer`, and the custom domain scorer
   - Import prebuilt scorers from `@mastra/evals/scorers/prebuilt`
   - Custom scorer uses `.preprocess() → .analyze() → .generateScore() → .generateReason()` chain

3. **`src/mastra/scorers/datasets/{AGENT_NAME}.json`**
   - `agentId`: `{AGENT_ID}`
   - `thresholds`: `{ "hallucination": 0.85, "completeness": 0.3, "domain": 0.8 }`
   - `cases`: minimum 5 — happy path, missing fields (nulls), edge case, anti-hallucination (null for absent data), domain-specific
   - Each case has `name`, `input`, `expectedFields` (deep partial equality — only fields you want to assert)

4. **`src/mastra/index.ts`** — register the new agent:
   ```typescript
   import { {camelCase}Agent } from './agents/{AGENT_NAME}';
   // add to mastra({ agents: { ..., {AGENT_ID}: {camelCase}Agent } })
   ```

---

### Constraints

- Never read `process.env` directly — use `env` from `../../lib/env`
- Never construct any AI SDK client before `configureAIMock()` runs (it's called in `index.ts` before agents are constructed — safe)
- Use relative imports only
- Model string format: `provider/model-id` (e.g. `anthropic/claude-sonnet-4-6`)
- completeness threshold: `0.3` (not `0.7`) — prebuilt scorer measures prose coverage, which is naturally low for extraction agents
- Scorer imports: `createHallucinationScorer` and `createCompletenessScorer` come from `@mastra/evals/scorers/prebuilt`, not `@mastra/evals/scorers/llm` or `@mastra/evals/scorers/code`

---

### Implementation Order

1. Write the Zod schema and agent shell (no scorers yet) → `npm run typecheck`
2. Write the scorers file → `npm run typecheck`
3. Write the dataset JSON
4. Register in `index.ts` → `npm run typecheck`
5. `npm run dev` → verify agent appears in Studio
6. Send one live test message in Studio to confirm structured output
7. `npm run eval` → confirm all cases pass and exit 0

---

### Eval Cases Guidance

```
{EVAL_CASES}
```

Anti-hallucination cases are mandatory. If a field is absent from the input, the agent must return `null` — never invent data. Include at least one case where a key field is missing and assert `"field": null` in `expectedFields`.
