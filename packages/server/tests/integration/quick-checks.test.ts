import { randomUUID } from 'node:crypto';
import { type MastraScorer, runEvals } from '@mastra/core/evals';
import { checks } from '@mastra/evals/checks';
import { describe, expect, it } from 'vitest';
import { testChatAgent } from '../helpers/test-mastra';

/**
 * Mastra's Quick Checks (@mastra/evals/checks) as runEvals GATES, against AIMock.
 * A gate must score 1.0 or the verdict is 'failed'. Quick Checks make no LLM call,
 * and the model here is AIMock, so this whole file costs nothing and runs in CI.
 *
 * Under AIMock the model's choices are scripted by fixtures, so these gates prove
 * the plumbing (tools are wired, run without errors, answers come back) — not the
 * model's judgment. `pnpm eval` runs the same kind of gates against a real model.
 */

// biome-ignore lint/suspicious/noExplicitAny: runEvals declares gates as MastraScorer<any, any, any, any>[]
async function verdict(input: string, gates: MastraScorer<any, any, any, any>[]) {
  // chatAgent's task tracker needs memory with a resource AND thread. The runEvals
  // JSDoc says it injects a thread per item, but on core 1.52.1 a single-`input`
  // item reaches generate() with threadId undefined and throws, so pass one.
  const result = await runEvals({
    data: [{ input }],
    target: testChatAgent,
    targetOptions: { memory: { resource: 'u-quick-checks', thread: randomUUID() } },
    gates,
  });
  return result.verdict;
}

describe('Quick Check gates (AIMock)', () => {
  it('weather: calls getWeather, no tool errors, answers from the result', async () => {
    expect(
      await verdict("What's the weather in Los Angeles?", [
        checks.calledTool('getWeather'),
        checks.noToolErrors(),
        checks.includes('looks clear'),
      ]),
    ).toBe('passed');
  });

  it('how-to: calls searchKnowledge and not getWeather', async () => {
    expect(
      await verdict('How do I use Mastra memory?', [
        checks.calledTool('searchKnowledge'),
        checks.didNotCall('getWeather'),
        checks.noToolErrors(),
      ]),
    ).toBe('passed');
  });

  it('greeting: uses no tools', async () => {
    expect(await verdict('Hello', [checks.usedNoTools(), checks.includes('How can I help')])).toBe(
      'passed',
    );
  });

  // The gates are not vacuous: demanding a tool the greeting never calls fails.
  it('fails the verdict when a gate is not met', async () => {
    expect(await verdict('Hello', [checks.calledTool('getWeather')])).toBe('failed');
  });
});
