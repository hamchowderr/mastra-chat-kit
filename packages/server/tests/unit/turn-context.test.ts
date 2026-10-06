import type { AgentControllerSubagent } from '@mastra/core/agent-controller';
import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it } from 'vitest';
import {
  isTimeZone,
  resolveTimeZone,
  TIME_ZONE_KEY,
  TurnContextProcessor,
  todaySection,
  withTurnContext,
} from '../../src/mastra/lib/turn-context';
import { streamBodySchema } from '../../src/mastra/routes/stream-body';

/**
 * Today's date for the agent (lib/turn-context.ts). The clock is fixed at
 * 2026-10-16T05:30Z: Thursday 22:30 in Los Angeles, already Friday 05:30 in UTC.
 */
const NOW = new Date('2026-10-16T05:30:00Z');
const inZone = (timeZone?: string) => {
  const rc = new RequestContext();
  if (timeZone !== undefined) rc.set(TIME_ZONE_KEY, timeZone);
  return rc;
};

describe('time zones', () => {
  it('accepts IANA zones and UTC, refuses anything else', () => {
    expect(isTimeZone('America/Los_Angeles')).toBe(true);
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone(42)).toBe(false);
  });

  it("uses the user's zone, and falls back to DEFAULT_TIMEZONE (UTC here) without one", () => {
    expect(resolveTimeZone(inZone('Asia/Tokyo'))).toBe('Asia/Tokyo');
    expect(resolveTimeZone(inZone())).toBe('UTC');
    expect(resolveTimeZone(inZone('Mars/Olympus_Mons'))).toBe('UTC');
    expect(resolveTimeZone(undefined)).toBe('UTC');
  });

  it('the stream body keeps a known zone and drops an unknown one, never refusing the turn', () => {
    const ok = streamBodySchema.parse({ text: 'hi', timeZone: 'America/New_York' });
    expect(ok.timeZone).toBe('America/New_York');
    const unknown = streamBodySchema.safeParse({ text: 'hi', timeZone: 'Mars/Olympus_Mons' });
    expect(unknown.success).toBe(true);
    expect(unknown.data?.timeZone).toBeUndefined();
    expect(streamBodySchema.parse({ text: 'hi' }).timeZone).toBeUndefined();
  });
});

describe("today's date", () => {
  it("states the date, weekday and time in the user's zone, and the next seven days", async () => {
    const text = await todaySection({ requestContext: inZone('America/Los_Angeles'), now: NOW });
    expect(text).toContain(
      'Current date and time: Thursday 2026-10-15, 22:30 (America/Los_Angeles, UTC-07:00).',
    );
    expect(text).toContain(
      'The next seven days: Friday 2026-10-16, Saturday 2026-10-17, Sunday 2026-10-18, Monday 2026-10-19, Tuesday 2026-10-20, Wednesday 2026-10-21, Thursday 2026-10-22.',
    );
  });

  it('is a different day in another zone', async () => {
    const text = await todaySection({ requestContext: inZone('UTC'), now: NOW });
    expect(text).toContain('Current date and time: Friday 2026-10-16, 05:30 (UTC, UTC+00:00).');
    expect(text).toContain('The next seven days: Saturday 2026-10-17,');
    expect(text).toContain('Friday 2026-10-23.');
  });
});

describe('TurnContextProcessor', () => {
  const step = (
    systemMessages: { role: 'system'; content: string }[],
    requestContext?: RequestContext,
  ) =>
    new TurnContextProcessor({ now: () => NOW }).processInputStep({
      systemMessages,
      requestContext,
    } as unknown as Parameters<TurnContextProcessor['processInputStep']>[0]);

  it('adds the date AFTER the existing system messages, leaving them untouched', async () => {
    const instructions = { role: 'system' as const, content: 'You are a helpful assistant.' };
    const result = await step([instructions], inZone('America/Los_Angeles'));
    expect(result?.systemMessages[0]).toBe(instructions);
    expect(result?.systemMessages).toHaveLength(2);
    expect(String(result?.systemMessages[1]?.content)).toContain('Thursday 2026-10-15');
  });

  it('takes extra sections, in order, for a project to extend', async () => {
    const processor = new TurnContextProcessor({
      now: () => NOW,
      sections: [todaySection, () => 'Business: Cultured Matter.', () => undefined],
    });
    const result = await processor.processInputStep({
      systemMessages: [],
      requestContext: inZone('UTC'),
    } as unknown as Parameters<TurnContextProcessor['processInputStep']>[0]);
    const content = String(result?.systemMessages[0]?.content);
    expect(content.indexOf('Current date and time')).toBeLessThan(content.indexOf('Business:'));
    expect(content.endsWith('Business: Cultured Matter.')).toBe(true);
  });
});

describe('subagents', () => {
  it('get the date after their own instructions, in the parent turn’s zone', async () => {
    const definition: AgentControllerSubagent = {
      id: 'writer',
      name: 'Writer',
      description: 'Writes.',
      instructions: 'You write things.',
    };
    const wrapped = withTurnContext(definition);
    expect(typeof wrapped.instructions).toBe('function');
    const resolve = wrapped.instructions as (args: {
      requestContext: RequestContext;
    }) => Promise<string[]>;
    const [own, context] = await resolve({ requestContext: inZone('Asia/Tokyo') });
    expect(own).toBe('You write things.');
    expect(context).toContain('(Asia/Tokyo, UTC+09:00)');
  });
});
