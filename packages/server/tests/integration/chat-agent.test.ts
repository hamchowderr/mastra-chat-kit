import { anthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs } from 'ai';
import { describe, expect, it } from 'vitest';
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

describe('chat agent (AIMock)', () => {
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

  it('reasons then searches the knowledge base', async () => {
    const res = await testChatAgent.generate('How do I use Mastra memory?', {
      memory: { thread: 'search', resource: 'u-search' },
      stopWhen: stopAfter5Steps,
    });
    expect(JSON.stringify(res)).toContain('searchKnowledge');
    expect(res.text.toLowerCase()).toContain('memory');
  });

  it('issues two tools in one turn (searchKnowledge + getWeather)', async () => {
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
    expect(blob).toContain('searchKnowledge');
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
