import { stepCountIs } from 'ai';
import { describe, expect, it } from 'vitest';
import { testChatAgent } from '../helpers/test-mastra';

/**
 * Agent mode end-to-end through AIMock — deterministic, zero spend.
 * Proves: text streaming, tool-calling round-trips, and reasoning, all driven
 * by fixtures in fixtures/chat.json. Each test uses its own thread/resource so
 * AIMock fixture matching is not affected by cross-test history.
 */
describe('chat agent — Agent mode (AIMock)', () => {
  it('answers a greeting with text', async () => {
    const res = await testChatAgent.generate('Hello', {
      memory: { thread: 'greeting', resource: 'u-greeting' },
    });
    expect(res.text.toLowerCase()).toContain('help');
  });

  it('calls getWeather and returns a grounded answer', async () => {
    const res = await testChatAgent.generate("What's the weather in Los Angeles?", {
      memory: { thread: 'weather', resource: 'u-weather' },
      stopWhen: stepCountIs(5),
    });
    expect(JSON.stringify(res)).toContain('getWeather');
    expect(res.text.toLowerCase()).toContain('los angeles');
  });

  it('reasons then searches the knowledge base', async () => {
    const res = await testChatAgent.generate('How do I use Mastra memory?', {
      memory: { thread: 'search', resource: 'u-search' },
      stopWhen: stepCountIs(5),
    });
    expect(JSON.stringify(res)).toContain('searchKnowledge');
    expect(res.text.toLowerCase()).toContain('memory');
  });
});
