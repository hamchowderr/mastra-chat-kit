import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatAgent } from '../../src/mastra/agents/chat';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';
import { features } from '../../src/mastra/lib/features';
import { stableSection, turnContextSections } from '../../src/mastra/lib/turn-context';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import type { ChatServerDeps } from '../../src/mastra/routes/types';
import { ctx, deps, find } from '../helpers/route-harness';

/**
 * Prompt caching (lib/turn-context.ts) on the wire: the Anthropic request the model
 * provider receives (AIMock's /v1/messages) carries `cache_control` where intended.
 */

afterEach(() => vi.restoreAllMocks());

type Block = { text: string; cache_control?: unknown };
type Request = {
  system?: Block[];
  tools?: { name: string; cache_control?: unknown }[];
  messages?: { content: unknown }[];
  cache_control?: unknown;
};

/** Every Anthropic request body sent to AIMock, parsed. */
function captureProviderRequests() {
  const sent: Request[] = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/v1/messages') && typeof init?.body === 'string') {
      sent.push(JSON.parse(init.body) as Request);
    }
    return realFetch(input, init);
  });
  return sent;
}

/** The chat agent's request (the thread-title call goes to the model too). */
const chatRequest = (sent: Request[]) =>
  sent.find((r) => r.system?.some((b) => b.text.includes('Current date and time')));

/** How many cache breakpoints a request carries; Anthropic refuses more than four. */
const breakpoints = (r: Request) => JSON.stringify(r).split('"cache_control"').length - 1;

const EPHEMERAL = { type: 'ephemeral' };

async function postStream(resourceId: string, text: string) {
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
    const { c } = ctx({ body: { text, timeZone: 'UTC' } });
    const res = await route.handler(c);
    if (res instanceof Response) await res.text();
  } finally {
    await controller.destroy();
  }
}

describe('prompt caching on (AIMock)', () => {
  it('breaks after the instructions, never on the date, and on the conversation tail', async () => {
    const sent = captureProviderRequests();
    await postStream('u-cache-on', 'When is Friday?');

    const request = chatRequest(sent);
    expect(request).toBeDefined();
    const system = request?.system ?? [];
    const date = system.findIndex((b) => b.text.includes('Current date and time'));
    // The block right before the turn context closes the cached prefix: the tool schemas
    // (sent first) and every system block up to it.
    expect(system[date - 1]?.cache_control).toEqual(EPHEMERAL);
    expect(system.slice(0, date).some((b) => b.text.includes('Never fabricate tool results'))).toBe(
      true,
    );
    expect(system[date]?.cache_control).toBeUndefined();
    expect(system.slice(date).every((b) => !b.cache_control)).toBe(true);
    // No per-tool marker is needed: tools come before the system prompt.
    expect(request?.tools?.length).toBeGreaterThan(0);
    expect(request?.tools?.every((t) => !t.cache_control)).toBe(true);
    // Request-level cacheControl: Anthropic puts it on the last block of the prompt.
    expect(request?.cache_control).toEqual(EPHEMERAL);
    expect(breakpoints(request as Request)).toBeLessThanOrEqual(4);
  });

  it("puts a project's stable section in its own cached block, before the date", async () => {
    const profile = stableSection(() => 'About the business: Cultured Matter, a test bakery.');
    turnContextSections.unshift(profile);
    try {
      const sent = captureProviderRequests();
      await postStream('u-cache-stable', 'When is Friday?');

      const system = chatRequest(sent)?.system ?? [];
      const stable = system.findIndex((b) => b.text.startsWith('About the business'));
      const date = system.findIndex((b) => b.text.includes('Current date and time'));
      expect(stable).toBeGreaterThan(0);
      expect(date).toBe(stable + 1);
      expect(system[stable]?.cache_control).toEqual(EPHEMERAL);
      expect(system[stable - 1]?.cache_control).toEqual(EPHEMERAL);
      expect(system[date]?.cache_control).toBeUndefined();
      expect(breakpoints(chatRequest(sent) as Request)).toBe(3);
    } finally {
      turnContextSections.splice(turnContextSections.indexOf(profile), 1);
    }
  });
});

describe('prompt caching off (AIMock)', () => {
  it('sends no cache_control at all', async () => {
    const agent = createChatAgent({ ...features, promptCache: false });
    new Mastra({ agents: { chat: agent }, storage: new InMemoryStore() });
    const sent = captureProviderRequests();
    await agent.generate('When is Friday?', {
      memory: { thread: 'cache-off', resource: 'u-cache-off' },
    });

    const request = chatRequest(sent);
    expect(request).toBeDefined();
    expect(JSON.stringify(request)).not.toContain('cache_control');
  });
});
