# Polish 04 — Completeness Scorer Investigation

The current state: completeness scorer reports 0.364 against a threshold of 0.3. That's barely above the floor and tells us nothing useful about agent quality.

## What's happening

The prebuilt `createCompletenessScorer` from `@mastra/evals/scorers/code` measures **lexical coverage**: how much of the input text appears (or is paraphrased) in the output text.

For a chatty agent that summarizes user input back, completeness scores high (0.7+).

For our `leadIntake` agent, completeness scores low because:
- Input is freeform prose (~50-100 words)
- Output is a sparse JSON object (~6 fields)
- Most input words (verbs, conjunctions, narrative framing) deliberately don't appear in output
- The scorer doesn't know that's intentional — it just sees "output covers 36% of input"

So 0.364 isn't measuring quality. It's measuring "structured extraction looks lossy compared to chat."

## Three possible fixes

### Option A: Replace with a different prebuilt scorer

Look at what's available in `@mastra/evals/scorers/prebuilt`:

- `createAnswerRelevancyScorer` — does the output address what was asked?
- `createFaithfulnessScorer` — does the output stay faithful to input facts? (good for anti-hallucination, but we already have `createHallucinationScorer`)
- `createKeywordCoverageScorer` — like completeness but for explicit keywords; could check that key entities (name, email, company, intent) appear in output
- `createPromptAlignmentScorer` — does the output follow the agent's instructions?

`createPromptAlignmentScorer` is the most aligned with what we actually want to measure: did the agent follow the instructions ("If a field is not present, return null. Never guess.")

### Option B: Build a custom scorer

`createScorer` from `@mastra/core/evals` with a code-only `.generateScore()` step. Much faster than LLM-judged. Logic: parse output JSON, check that every entity mentioned in input appears in output (and vice versa — no extras).

Pseudocode:
```ts
.generateScore(({ run }) => {
  const input = getUserMessageFromRunInput(run.input);
  const output = JSON.parse(getAssistantMessageFromRunOutput(run.output));

  let extracted = 0, total = 0;

  // Check email if present in input
  if (/[^\s]+@[^\s]+/.test(input)) {
    total++; if (output.email) extracted++;
  }

  // Check phone, company, name patterns similarly...

  return total === 0 ? 1 : extracted / total;
});
```

This actually measures "did the agent extract what was extractable." Useful signal.

### Option C: Drop completeness entirely

Two scorers (hallucination + urgency) might be sufficient for this agent. Document the choice:
> "We dropped completeness for leadIntake because it wasn't a meaningful signal for structured extraction. New agents in this template should evaluate whether completeness applies to them before adding it."

## Recommendation

**Option A with `createPromptAlignmentScorer`.** Reasons:
- Stays "prebuilt scorer" so the spec philosophy holds (avoid reinventing wheels)
- Measures something genuinely useful (instruction-following)
- Doesn't require us to maintain a custom extraction-checking scorer
- Easy fallback to Option B if Option A has its own quirks

## Implementation

### 1. Verify the scorer is available

```bash
cat node_modules/@mastra/evals/dist/scorers/prebuilt/index.d.ts | grep -i alignment
```

Confirm `createPromptAlignmentScorer` is exported. Look at its options:

```bash
cat node_modules/@mastra/evals/dist/scorers/llm/prompt-alignment/index.d.ts
```

### 2. Replace `completenessScorer` in `src/mastra/scorers/_example.scorers.ts`

```ts
import { createPromptAlignmentScorer } from '@mastra/evals/scorers/prebuilt';

export const promptAlignmentScorer = createPromptAlignmentScorer({
  model: 'anthropic/claude-sonnet-4-6',
  // ... other options if the type def shows them
});
```

Remove `completenessScorer` from the same file.

### 3. Update agent registration in `src/mastra/agents/_example.ts`

```ts
import {
  hallucinationScorer,
  promptAlignmentScorer,  // was: completenessScorer
  urgencyScorer,
} from '../scorers/_example.scorers';

// In Agent config:
scorers: {
  hallucination: { scorer: hallucinationScorer, sampling: { type: 'ratio', rate: 1 } },
  promptAlignment: { scorer: promptAlignmentScorer, sampling: { type: 'ratio', rate: 1 } },
  urgency: { scorer: urgencyScorer, sampling: { type: 'ratio', rate: 1 } },
},
```

### 4. Update `src/mastra/index.ts` registration

```ts
import { hallucinationScorer, promptAlignmentScorer, urgencyScorer } from './scorers/_example.scorers';
// ... use the new name in the Mastra() config
```

### 5. Update the CI dataset

Edit `src/mastra/scorers/datasets/_example.json`:
- Remove `"completeness"` from `thresholds`
- Add `"promptAlignment": 0.7` (or whatever feels right; calibrate after first run)

### 6. Run live eval and observe

```bash
npm run eval
```

Look at what `promptAlignment` actually scores on the 5 cases. If it lands somewhere reasonable (0.7–0.95), set the threshold at the lower bound minus a small margin (e.g., 0.65).

If it scores 1.0 across all cases (over-permissive judge), tighten the prompt or fall back to Option B (custom scorer).

If it scores 0 across all cases (over-strict judge), look at the judge's reasoning in the score output and adjust.

### 7. Re-verify the eval gate passes

```bash
npm run eval
```

Should exit 0 with the new threshold.

## What to capture in PROGRESS.md

```
## Polish 04: Completeness Scorer Fix
- Status: complete | blocked
- Decision: replaced completenessScorer with promptAlignmentScorer
- Threshold calibration: <new threshold value, based on observed live scores>
- Live eval scores: <hallucination=X, promptAlignment=Y, urgency=Z>
- Notes: <judge behavior, any deviations>
```

## If Option A doesn't work

Document why in PROGRESS.md (e.g., "promptAlignment requires a `prompt` parameter we don't have a clean source for, and inferring it gave inconsistent scores"). Then proceed with Option B (custom code-based scorer) or Option C (drop completeness, two scorers is fine).

Do not attempt to keep the original `completenessScorer` with the lowered threshold. That's the explicit thing we're trying to fix — a metric that doesn't measure quality.

## Stop after this step

Wait for owner review. The threshold calibration is judgment-laden and worth confirming.
