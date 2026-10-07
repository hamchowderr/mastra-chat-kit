/**
 * pnpm measure:cache — what prompt caching (lib/turn-context.ts) saves, on a REAL model.
 *
 * Runs the same two-turn conversation twice, once with PROMPT_CACHE off and once on, and
 * prints each model call's input tokens, cache writes, cache reads and cost (as the
 * provider reports them). It spends real tokens, so it is NOT part of CI. From
 * PowerShell (Git Bash mangles the leading-slash --path):
 *
 *   infisical run --path=/mastra-chat-kit --silent -- pnpm --filter @mastra-chat-kit/server measure:cache
 *
 * Cost controls: four short turns, output capped per call, thread titling off, and
 * NODE_ENV=test, which turns off observational memory and the agent workspace.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Environment BEFORE any app module loads: src/lib/env.ts validates at import.
const scratch = mkdtempSync(path.join(tmpdir(), 'chat-kit-cache-'));
process.env.NODE_ENV = 'test';
process.env.USE_AIMOCK = 'false';
process.env.CHAT_MODEL ??= 'vercel/anthropic/claude-haiku-4.5';
process.env.TURSO_DATABASE_URL = `file:${path.join(scratch, 'cache.db').replace(/\\/g, '/')}`;
process.env.APP_SECRET ??= randomBytes(32).toString('hex');

const model = process.env.CHAT_MODEL;
if (model.startsWith('vercel/') && !process.env.AI_GATEWAY_API_KEY?.startsWith('vck_')) {
  console.error(
    'AI_GATEWAY_API_KEY is missing or is not a Vercel AI Gateway key. Run this through `infisical run` (see header).',
  );
  process.exit(1);
}

const TURNS = (process.env.CACHE_TURNS ?? "What's the weather in Paris?|And in Rome?").split('|');
const MAX_OUTPUT_TOKENS = 512;

const { Mastra } = await import('@mastra/core/mastra');
const { InMemoryStore } = await import('@mastra/core/storage');
const { createChatAgent } = await import('../src/mastra/agents/chat');
const { features } = await import('../src/mastra/lib/features');

type Row = Record<string, string | number>;

/** One model call's numbers. The gateway reports its cost on providerMetadata.gateway. */
function row(label: string, usage: Record<string, unknown>, meta?: Record<string, unknown>): Row {
  const anthropic = (meta?.anthropic ?? {}) as Record<string, unknown>;
  const gateway = (meta?.gateway ?? {}) as Record<string, unknown>;
  const details = (usage.inputTokenDetails ?? {}) as Record<string, number | undefined>;
  return {
    call: label,
    input: Number(usage.inputTokens ?? 0),
    cacheWrite: Number(details.cacheWriteTokens ?? anthropic.cacheCreationInputTokens ?? 0),
    cacheRead: Number(details.cacheReadTokens ?? usage.cachedInputTokens ?? 0),
    output: Number(usage.outputTokens ?? 0),
    cost: Number(gateway.cost ?? 0),
  };
}

async function conversation(promptCache: boolean): Promise<Row[]> {
  const agent = createChatAgent({ ...features, generateImage: false, promptCache });
  const mastra = new Mastra({ agents: { chat: agent }, storage: new InMemoryStore() });
  const chat = mastra.getAgent('chat');
  const thread = randomUUID();
  const rows: Row[] = [];
  for (const [t, prompt] of TURNS.entries()) {
    const result = await chat.generate(prompt, {
      memory: { resource: `u-cache-${thread}`, thread, options: { generateTitle: false } },
      modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS },
    });
    for (const [s, step] of result.steps.entries()) {
      rows.push(
        row(
          `turn ${t + 1} step ${s + 1}`,
          step.usage as unknown as Record<string, unknown>,
          step.providerMetadata,
        ),
      );
    }
  }
  return rows;
}

function total(rows: Row[]): Row {
  const sum = (k: string) => rows.reduce((n, r) => n + Number(r[k]), 0);
  return {
    call: 'total',
    input: sum('input'),
    cacheWrite: sum('cacheWrite'),
    cacheRead: sum('cacheRead'),
    output: sum('output'),
    cost: Number(sum('cost').toFixed(6)),
  };
}

console.log(`Model ${model} · ${TURNS.length} turns, cache off then on\n`);
for (const promptCache of [false, true]) {
  const rows = await conversation(promptCache);
  console.log(`PROMPT_CACHE=${promptCache}`);
  console.table([...rows, total(rows)]);
}
process.exit(0);
