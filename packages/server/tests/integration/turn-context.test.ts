import { RequestContext } from '@mastra/core/request-context';
import { InMemoryStore } from '@mastra/core/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';
import { TIME_ZONE_KEY } from '../../src/mastra/lib/time-zone';
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
 * provider requests. The thread-title call goes to the model too, so pick the one with the date.
 */
function systemOf(sent: string[]): string {
  const systems = sent.map((body) => {
    const { system } = JSON.parse(body) as { system?: string | { text: string }[] };
    return typeof system === 'string' ? system : (system ?? []).map((b) => b.text).join('\n');
  });
  return systems.find((s) => s.includes('Current date and time')) ?? '';
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
    const instructions = system.indexOf('Never fabricate tool results');
    expect(instructions).toBeGreaterThan(-1);
    expect(system.indexOf('Current date and time')).toBeGreaterThan(instructions);
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

describe("today's date in subagents (AIMock)", () => {
  /** Run one turn on a real session, approving any gate, in Los Angeles time. */
  async function turn(resourceId: string, content: string) {
    const controller = createChatAgentController({
      storage: new InMemoryStore(),
      resourceId,
      browser: null,
    });
    await controller.init();
    const session = await controller.createSession({ resourceId });
    // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide
    const events: any[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event);
      if (event.type === 'tool_approval_required') {
        session.respondToToolApproval({ decision: 'approve' });
      }
    });
    try {
      await session.thread.create();
      const requestContext = new RequestContext();
      requestContext.set(TIME_ZONE_KEY, 'America/Los_Angeles');
      await session.sendMessage({ content, requestContext });
    } finally {
      unsubscribe();
      await controller.destroy();
    }
    return events;
  }

  const systemsOf = (sent: string[]) =>
    sent.map((body) => {
      const parsed = JSON.parse(body) as { system?: string | { text: string }[] };
      const system =
        typeof parsed.system === 'string'
          ? parsed.system
          : (parsed.system ?? []).map((b) => b.text).join('\n');
      return { body, system };
    });
  const LA_TODAY = 'Current date and time: Thursday 2026-10-15, 22:30 (America/Los_Angeles';

  it('a forked subagent run (the chat agent itself) gets the date from the processor', async () => {
    const sent = captureProviderRequests();
    const events = await turn('u-date-fork', 'Date test: ask a forked subagent what day it is.');

    expect(JSON.stringify(events)).toContain('The forked subagent answered.');
    // Two requests carry the delegate call: the fork's own (it ends on the cloned call)
    // and the parent's hop after it. Both are the chat agent, and both carry the date.
    const withCall = systemsOf(sent).filter(({ body }) => body.includes('toolu_date_fork'));
    expect(withCall.length).toBeGreaterThanOrEqual(2);
    for (const { system } of withCall) {
      expect(system).toContain('Never fabricate tool results');
      expect(system).toContain(LA_TODAY);
    }
  });

  it('a specialist (the writer) gets the date after its own instructions', async () => {
    const sent = captureProviderRequests();
    const events = await turn('u-date-writer', 'Date test: ask the writer what day it is.');

    expect(JSON.stringify(events)).toContain('The writer answered.');
    const writer = systemsOf(sent).find(
      ({ body, system }) =>
        body.includes('Writer date task') && !system.includes('Never fabricate tool results'),
    );
    expect(writer).toBeDefined();
    expect(writer?.system).toContain(LA_TODAY);
    expect(writer?.system.indexOf(LA_TODAY)).toBeGreaterThan(0);
  });
});
