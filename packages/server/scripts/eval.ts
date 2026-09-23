/**
 * pnpm eval: the chat agent against a REAL model, gated by Mastra Quick Checks.
 *
 * The AIMock suite proves the wiring; this measures the model's own choices
 * (does it pick the right tool, and stay off tools it doesn't need). It spends
 * real tokens, so it is NOT part of CI. Run it on demand, after a prompt or tool
 * change. From PowerShell (Git Bash mangles the leading-slash --path):
 *
 *   infisical run --path=/mastra-chat-kit --silent -- pnpm --filter @mastra-chat-kit/server eval
 *
 * Cost controls:
 * - Quick Checks make no LLM call, and thread titling is switched off for the run
 *   (each prompt uses a fresh thread, so memory would title every one with a
 *   separate call the token total cannot see). The only spend is the agent's own turns.
 * - One prompt at a time, output capped per call, and a running token total that
 *   aborts the run past EVAL_TOKEN_BUDGET (default 60,000).
 * - generateImage is switched off for the run (image generation is billed per image).
 * - NODE_ENV=test turns off observational memory and the agent workspace, so no
 *   Observer/Reflector calls and nothing touches the real workspace.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MastraScorer } from '@mastra/core/evals';

// Environment BEFORE any app module loads: src/lib/env.ts validates at import.
const scratch = mkdtempSync(path.join(tmpdir(), 'chat-kit-eval-'));
process.env.NODE_ENV = 'test';
process.env.USE_AIMOCK = 'false';
process.env.CHAT_MODEL ??= 'vercel/anthropic/claude-sonnet-4.6';
process.env.TURSO_DATABASE_URL = `file:${path.join(scratch, 'eval.db').replace(/\\/g, '/')}`;
process.env.APP_SECRET ??= randomBytes(32).toString('hex');

const model = process.env.CHAT_MODEL;
// One model key per project: the Vercel AI Gateway. A real key starts with `vck_`.
// Anything else, like an unresolved Infisical reference, would fail on the first call.
if (model.startsWith('vercel/') && !process.env.AI_GATEWAY_API_KEY?.startsWith('vck_')) {
  console.error(
    'AI_GATEWAY_API_KEY is missing or is not a Vercel AI Gateway key. Run this through `infisical run` (see header).',
  );
  process.exit(1);
}

const BUDGET = Number(process.env.EVAL_TOKEN_BUDGET ?? 60_000);
if (!Number.isFinite(BUDGET) || BUDGET <= 0) {
  // A NaN budget would make the over-budget check never fire.
  console.error(
    `EVAL_TOKEN_BUDGET must be a positive number of tokens, got "${process.env.EVAL_TOKEN_BUDGET}".`,
  );
  process.exit(1);
}
const MAX_OUTPUT_TOKENS = 1024;

const { runEvals } = await import('@mastra/core/evals');
const { checks } = await import('@mastra/evals/checks');
const { Mastra } = await import('@mastra/core/mastra');
const { InMemoryStore } = await import('@mastra/core/storage');
const { chatAgent } = await import('../src/mastra/agents/chat');

const mastra = new Mastra({ agents: { chat: chatAgent }, storage: new InMemoryStore() });
const agent = mastra.getAgent('chat');
const activeTools = Object.keys(await agent.listTools()).filter((t) => t !== 'generateImage');

type Case = { input: string; gates: MastraScorer<any, any, any, any>[] };

const weather = () => [checks.calledTool('getWeather'), checks.noToolErrors()];
const howTo = () => [
  checks.calledTool('searchKnowledge'),
  checks.didNotCall('getWeather'),
  checks.noToolErrors(),
];
const chitChat = () => [checks.usedNoTools()];

const cases: Case[] = [
  { input: "What's the weather in Tokyo?", gates: weather() },
  { input: 'Is it raining in Seattle right now?', gates: weather() },
  { input: 'How do I use Mastra memory?', gates: howTo() },
  { input: 'How does semantic recall work in Mastra?', gates: howTo() },
  { input: 'Hi there!', gates: chitChat() },
  { input: "Thanks, that's all for now.", gates: chitChat() },
];

let spent = 0;
let failed = 0;
console.log(`Model ${model} · ${cases.length} prompts · token budget ${BUDGET}\n`);

/** The provider's own message (billing, auth, rate limit), without the stack dump. */
function rootMessage(err: unknown): string {
  let cur = err as { message?: string; cause?: unknown } | undefined;
  let msg = String(cur?.message ?? err);
  while (cur?.cause) {
    cur = cur.cause as typeof cur;
    msg = String(cur?.message ?? msg);
  }
  return msg;
}

for (const c of cases) {
  const result = await runEvals({
    data: [{ input: c.input }],
    target: agent,
    // A fresh thread per prompt, so no prompt sees another's answer. runEvals does
    // not inject one for a single-input item on core 1.52.1.
    targetOptions: {
      memory: { resource: 'u-eval', thread: randomUUID(), options: { generateTitle: false } },
      modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      activeTools,
    },
    gates: c.gates,
    concurrency: 1,
    onItemComplete: ({ targetResult }) => {
      spent += targetResult.usage?.totalTokens ?? 0;
    },
  }).catch((err: unknown) => {
    // The model call itself failed, so no later prompt would fare better.
    console.error(`\nStopped on "${c.input}": ${rootMessage(err)}`);
    process.exit(3);
  });

  const ok = result.verdict === 'passed';
  if (!ok) {
    failed++;
  }
  const detail = (result.gateResults ?? [])
    .filter((g) => !g.passed)
    .map((g) => g.id)
    .join(', ');
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.input}${detail ? `   (failed: ${detail})` : ''}`);

  if (spent > BUDGET) {
    console.error(`\nStopped: ${spent} tokens used, over the ${BUDGET} budget.`);
    process.exit(2);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed · ${spent} tokens used`);
process.exit(failed ? 1 : 0);
