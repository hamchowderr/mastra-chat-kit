import { anthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs } from 'ai';
import { beforeAll, describe, expect, it } from 'vitest';
import { syncChatKnowledge } from '../../src/mastra/lib/chat-knowledge';
import { testChatAgent } from '../helpers/test-mastra';

/**
 * The chat agent end-to-end through AIMock — deterministic, zero spend.
 * Proves: text streaming, tool-calling round-trips, and reasoning, all driven
 * by fixtures in fixtures/chat.json. Each test uses its own thread/resource so
 * AIMock fixture matching is not affected by cross-test history.
 */

// `ai@7`'s `stepCountIs` returns `StopCondition<TOOLS, RUNTIME_CONTEXT>` (two type
// parameters), but @mastra/core 1.52.1 still declares `stopWhen` as
// `StopConditionV5<any> | StopConditionV6<any>` — one parameter each. The runtime
// shape is identical (a predicate over `{ steps }`), so this is a stale `.d.ts` in
// Mastra rather than a real mismatch; drop the cast once core's types catch up to
// ai v7. Declared once here instead of at all three call sites.
// biome-ignore lint/suspicious/noExplicitAny: upstream StopCondition arity skew, see above
const stopAfter5Steps = stepCountIs(5) as any;

type ToolChunk = {
  toolName?: string;
  result?: unknown;
  payload?: { toolName?: string; result?: unknown };
};
const toolName = (c: ToolChunk) => c.payload?.toolName ?? c.toolName;
const toolResult = (c: ToolChunk) => c.payload?.result ?? c.result;

describe('chat agent (AIMock)', () => {
  // The sample folder (packages/server/knowledge) mirrored into Knowledge, as index.ts
  // does at boot. Idempotent: a re-run leaves every page unchanged.
  beforeAll(async () => {
    const counts = await syncChatKnowledge();
    expect(counts && counts.created + counts.updated + counts.unchanged).toBeGreaterThan(0);
  });

  it('answers a greeting with text', async () => {
    const res = await testChatAgent.generate('Hello', {
      memory: { thread: 'greeting', resource: 'u-greeting' },
    });
    expect(res.text.toLowerCase()).toContain('help');
  });

  it('calls getWeather and returns a grounded answer', async () => {
    const res = await testChatAgent.generate("What's the weather in Los Angeles?", {
      memory: { thread: 'weather', resource: 'u-weather' },
      stopWhen: stopAfter5Steps,
    });
    expect(JSON.stringify(res)).toContain('getWeather');
    expect(res.text.toLowerCase()).toContain('los angeles');
  });

  it('reasons, then searches Knowledge and gets the synced sample page back', async () => {
    const res = await testChatAgent.generate('How do I use Mastra memory?', {
      memory: { thread: 'search', resource: 'u-search' },
      stopWhen: stopAfter5Steps,
    });
    // Only the model is mocked: knowledge_search runs for real against libSQL, so its
    // result is the page synced from knowledge/memory.md.
    const searches = ((res.toolResults ?? []) as ToolChunk[]).filter(
      (r) => toolName(r) === 'knowledge_search',
    );
    expect(searches).toHaveLength(1);
    const { results } = toolResult(searches[0] as ToolChunk) as {
      results: { type: string; page: { name: string; ref: string } }[];
    };
    expect(results.map((r) => r.page.name)).toContain('Mastra memory');
    expect(results.map((r) => r.page.ref)).toContain('org:chat-kit#memory');
    expect(res.text).toContain('"Mastra memory" page');
  });

  it('issues two tools in one turn (knowledge_search + getWeather)', async () => {
    const res = await testChatAgent.generate('Research Tokyo and tell me the weather there', {
      memory: { thread: 'multitool', resource: 'u-multitool' },
      stopWhen: stopAfter5Steps,
    });
    // The multi-tool fixture returns BOTH tool calls in one assistant turn, so
    // both render as <Tool> elements. We assert the tool invocations (reliable);
    // the final grounded answer that follows is exercised by the e2e against the
    // streaming route (the tier-1 generate() accessor doesn't reliably surface
    // post-multi-tool text under AIMock).
    const blob = JSON.stringify(res);
    expect(blob).toContain('knowledge_search');
    expect(blob).toContain('getWeather');
    expect(blob).toContain('Tokyo'); // tool args carry the query/location
  });
});

/**
 * Thread title generation runs `generateText` with a "3-6 word title" system
 * prompt (POST /threads/:id/title and Memory's generateTitle). The chg fixture
 * matches that on `systemMessage`, so the call resolves deterministically under
 * AIMock instead of falling through to the catch-all sentence.
 */
describe('thread title generation (AIMock)', () => {
  it('returns a short title from the title-gen system prompt', async () => {
    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5'),
      system:
        "Generate a concise 3-6 word title summarizing the user's request in this conversation. Output ONLY the plain title text — no markdown, no quotes.",
      prompt: 'user: Research Tokyo and tell me the weather there\nassistant: ...',
    });
    const title = text.trim();
    expect(title.length).toBeGreaterThan(0);
    expect(title.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(title.toLowerCase()).toContain('tokyo');
  });
});
