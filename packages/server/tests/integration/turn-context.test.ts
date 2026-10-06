import { InMemoryStore } from '@mastra/core/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import type { ChatServerDeps } from '../../src/mastra/routes/types';
import { ctx, deps, find } from '../helpers/route-harness';

/**
 * Today's date reaches the model (lib/turn-context.ts), through the real
 * /agent-controller/stream route on a real AgentController session on AIMock.
 *
 * The clock is frozen at 2026-10-16T05:30Z: Thursday 22:30 in Los Angeles, already
 * Friday in UTC. So "When is Friday?" has a different answer in each zone, and the
 * fixtures (fixtures/chat.json) answer from whichever date the model was given.
 */

beforeEach(() => {
  // Only Date: timers stay real, so the stream and AIMock run as usual.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T05:30:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Capture every request body sent to the model provider (AIMock's /v1/messages). */
function captureProviderRequests() {
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/v1/messages') && typeof init?.body === 'string') sent.push(init.body);
    return realFetch(input, init);
  });
  return sent;
}

/** POST /agent-controller/stream on a real controller; returns the status and SSE text. */
async function postStream(resourceId: string, body: Record<string, unknown>) {
  const controller = createChatAgentController({
    storage: new InMemoryStore(),
    resourceId,
    browser: null,
  });
  await controller.init();
  const session = await controller.createSession({ resourceId });
  try {
    const route = find(
      createControllerRoutes(
        deps({
          getSession: () => Promise.resolve(session),
          getAgentController: () =>
            Promise.resolve(
              controller as unknown as Awaited<ReturnType<ChatServerDeps['getAgentController']>>,
            ),
        }),
      ),
      '/agent-controller/stream',
      'POST',
    );
    const { c, captured } = ctx({ body });
    const res = await route.handler(c);
    if (!(res instanceof Response)) return { status: captured.status, text: '' };
    return { status: res.status, text: await res.text() };
  } finally {
    await controller.destroy();
  }
}

/**
 * The chat agent's system prompt (instructions, then the turn context), from the
 * provider requests. The thread-title call goes to the model too, so pick the chat one.
 */
function systemOf(sent: string[]): string {
  const systems = sent.map((body) => {
    const { system } = JSON.parse(body) as { system?: string | { text: string }[] };
    return typeof system === 'string' ? system : (system ?? []).map((b) => b.text).join('\n');
  });
  return systems.find((s) => s.includes('You are a helpful')) ?? '';
}

describe("today's date (AIMock)", () => {
  it("gives the model the date in the user's zone, after the instructions", async () => {
    const sent = captureProviderRequests();
    const { status } = await postStream('u-date-la', {
      text: 'When is Friday?',
      timeZone: 'America/Los_Angeles',
    });

    expect(status).toBe(200);
    const system = systemOf(sent);
    expect(system).toContain(
      'Current date and time: Thursday 2026-10-15, 22:30 (America/Los_Angeles, UTC-07:00).',
    );
    expect(system).toContain('The next seven days: Friday 2026-10-16,');
    // After the instructions, so the instruction prefix stays the same every turn.
    expect(system.indexOf('Current date and time')).toBeGreaterThan(
      system.indexOf('You are a helpful'),
    );
  });

  it('resolves "Friday" to the coming Friday in that zone, end to end', async () => {
    const { status, text } = await postStream('u-date-friday', {
      text: 'When is Friday?',
      timeZone: 'America/Los_Angeles',
    });

    expect(status).toBe(200);
    expect(text).toContain('Friday is 2026-10-16.');
  });

  it('falls back to DEFAULT_TIMEZONE (UTC in tests) for an unknown zone', async () => {
    const sent = captureProviderRequests();
    const { status, text } = await postStream('u-date-unknown', {
      text: 'When is Friday?',
      timeZone: 'Mars/Olympus_Mons',
    });

    expect(status).toBe(200);
    expect(systemOf(sent)).toContain('Current date and time: Friday 2026-10-16, 05:30 (UTC,');
    expect(text).toContain('Friday is 2026-10-23.');
  });
});
