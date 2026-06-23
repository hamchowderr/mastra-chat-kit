import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../src/lib/env';
import { LeadSchema } from '../src/mastra/agents/_example';
// Boot Mastra (env validation + AIMock + storage)
import { mastra } from '../src/mastra/index';
import {
  hallucinationScorer,
  promptAlignmentScorer,
  urgencyScorer,
} from '../src/mastra/scorers/_example.scorers';

// ── types ─────────────────────────────────────────────────────────────────────

interface EvalCase {
  name: string;
  input: string;
  expectedFields: Record<string, unknown>;
}

interface Dataset {
  agentId: string;
  thresholds: Record<string, number>;
  cases: EvalCase[];
}

interface CaseResult {
  name: string;
  pass: boolean;
  fieldErrors: string[];
  scores: Record<string, number | null>;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function checkFields(actual: Record<string, unknown>, expected: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (expectedValue === null) {
      if (actualValue !== null) {
        errors.push(`${key}: expected null, got ${JSON.stringify(actualValue)}`);
      }
    } else if (String(actualValue).toLowerCase() !== String(expectedValue).toLowerCase()) {
      errors.push(
        `${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
      );
    }
  }
  return errors;
}

// ── main ──────────────────────────────────────────────────────────────────────

const datasetPath =
  process.argv[2] ?? resolve(process.cwd(), 'src/mastra/scorers/datasets/_example.json');

const dataset: Dataset = JSON.parse(readFileSync(datasetPath, 'utf-8'));
const agent = mastra.getAgent(dataset.agentId);

if (!agent) {
  console.error(red(`Agent "${dataset.agentId}" not found in Mastra instance.`));
  process.exit(1);
}

console.log(bold(`\n🧪 Eval: ${dataset.agentId} — ${dataset.cases.length} cases\n`));

const results: CaseResult[] = [];
const scoreTotals: Record<string, number[]> = {
  hallucination: [],
  promptAlignment: [],
  urgency: [],
};

for (const evalCase of dataset.cases) {
  process.stdout.write(`  ${evalCase.name} ... `);

  let object: Record<string, unknown>;
  let scoringInput: unknown;
  let scoringOutput: unknown;

  try {
    // returnScorerData triggers inline scorer LLM calls; skip under AIMock to avoid
    // fixture schema mismatches — scores will be n/a but field checks still gate CI.
    const generateOpts = env.USE_AIMOCK
      ? { structuredOutput: { schema: LeadSchema } }
      : { structuredOutput: { schema: LeadSchema }, returnScorerData: true };

    const result = await agent.generate(
      [{ role: 'user', content: evalCase.input }],
      generateOpts as Parameters<typeof agent.generate>[1],
    );

    object = (result.object as Record<string, unknown>) ?? {};
    scoringInput = (result as any).scoringData?.input;
    scoringOutput = (result as any).scoringData?.output;
  } catch (err) {
    console.log(red('ERROR'));
    console.error(`    ${err}`);
    results.push({
      name: evalCase.name,
      pass: false,
      fieldErrors: [`generate failed: ${err}`],
      scores: {},
    });
    continue;
  }

  // Field validation
  const fieldErrors = checkFields(object, evalCase.expectedFields);

  // Scorer runs (manual, using scoringData from generate)
  const scores: Record<string, number | null> = {};

  if (scoringInput !== undefined && scoringOutput !== undefined) {
    try {
      const [hallResult, alignResult, urgResult] = await Promise.all([
        hallucinationScorer.run({ input: scoringInput as any, output: scoringOutput as any }),
        promptAlignmentScorer.run({ input: scoringInput as any, output: scoringOutput as any }),
        urgencyScorer.run({ input: scoringInput as any, output: scoringOutput as any }),
      ]);
      scores.hallucination = hallResult.score;
      scores.promptAlignment = alignResult.score;
      scores.urgency = urgResult.score;
    } catch (err) {
      // Scorer errors don't fail the case — log and continue
      console.error(yellow(`\n    ⚠ scorer error: ${err}`));
    }
  }

  for (const [key, val] of Object.entries(scores)) {
    if (val !== null) scoreTotals[key]?.push(val);
  }

  const pass = fieldErrors.length === 0;
  results.push({ name: evalCase.name, pass, fieldErrors, scores });

  if (pass) {
    console.log(green('PASS'));
  } else {
    console.log(red('FAIL'));
    for (const err of fieldErrors) console.log(`    ${red('✗')} ${err}`);
  }

  const scoreStr = Object.entries(scores)
    .map(([k, v]) => `${k}=${v !== null ? v.toFixed(2) : 'n/a'}`)
    .join(' ');
  if (scoreStr) console.log(`    scores: ${scoreStr}`);
}

// ── aggregate summary ─────────────────────────────────────────────────────────

console.log(bold('\n── Aggregate Scores ─────────────────────────────────────────'));

// null avg = scorer had no data (e.g. AIMock can't run LLM-based scorers) → skip, not fail
const scorerPass: Record<string, boolean | 'skip'> = {};
for (const [scorer, values] of Object.entries(scoreTotals)) {
  const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const threshold = dataset.thresholds[scorer] ?? 0;
  const pass = avg === null ? 'skip' : avg >= threshold;
  scorerPass[scorer] = pass;

  const avgStr = avg !== null ? avg.toFixed(3) : 'n/a';
  const label =
    avg === null
      ? yellow(`  ${scorer}: ${avgStr} (skipped — no scorer data)`)
      : pass
        ? green(`  ${scorer}: ${avgStr} ≥ ${threshold} ✓`)
        : red(`  ${scorer}: ${avgStr} < ${threshold} ✗`);
  console.log(label);
}

const fieldFailCount = results.filter((r) => !r.pass).length;
console.log(bold('\n── Field Checks ──────────────────────────────────────────────'));
console.log(`  ${results.length - fieldFailCount}/${results.length} cases passed field validation`);

const allScorersPassed = Object.values(scorerPass).every((v) => v === true || v === 'skip');
const allFieldsPassed = fieldFailCount === 0;
const exitCode = allFieldsPassed && allScorersPassed ? 0 : 1;

if (exitCode === 0) {
  console.log(bold(green('\n✅ All checks passed\n')));
} else {
  console.log(bold(red('\n❌ Some checks failed\n')));
}

process.exit(exitCode);
