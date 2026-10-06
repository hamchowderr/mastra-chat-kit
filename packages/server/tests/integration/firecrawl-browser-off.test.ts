import { InMemoryStore } from '@mastra/core/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type FirecrawlMock, startFirecrawlMock } from '../../scripts/firecrawl-mock';

/**
 * The Firecrawl key set and the sandbox off, but BROWSER_PROVIDER=viewer: the viewer
 * needs the sandbox, so there is no browser at all, and the agent is offered no browser
 * tools (Firecrawl search stays). Its counterpart with the Firecrawl browser on is
 * firecrawl-browser.test.ts.
 */

let fc: FirecrawlMock;

beforeAll(async () => {
  fc = await startFirecrawlMock();
  vi.stubEnv('FIRECRAWL_API_KEY', 'fc-test-key');
  vi.stubEnv('FIRECRAWL_MCP_URL', fc.url);
  vi.stubEnv('WORKSPACE_SANDBOX', 'false');
  vi.stubEnv('BROWSER_PROVIDER', 'viewer');
});

afterAll(async () => {
  const { disconnectFirecrawl } = await import('../../src/mastra/lib/firecrawl');
  await disconnectFirecrawl();
  await fc?.stop();
  vi.unstubAllEnvs();
});

describe('no browser (BROWSER_PROVIDER=viewer without the sandbox)', () => {
  it('a run offers the model no browser tools, and the Browser panel has nothing to show', async () => {
    // Dynamic imports: env.ts reads process.env once, when it first loads.
    const { features } = await import('../../src/mastra/lib/features');
    const ac = await import('../../src/mastra/lib/agent-controller');
    expect(features.browser).toBe(false);

    const controller = ac.createChatAgentController({
      storage: new InMemoryStore(),
      resourceId: 'u-browser-off',
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-browser-off' });

    const offered: string[][] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/v1/messages') && typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { tools?: { name: string }[] };
        if (body.tools?.length) offered.push(body.tools.map((t) => t.name));
      }
      return realFetch(input, init);
    });
    try {
      await session.thread.create({ title: 'off' });
      await session.sendMessage({ content: 'Hello' });
    } finally {
      spy.mockRestore();
      await controller.destroy();
    }

    expect(offered.length).toBeGreaterThan(0);
    expect(offered.flat().filter((name) => name.startsWith('browser_'))).toEqual([]);
    expect(offered[0]).toEqual(expect.arrayContaining(['firecrawl_search', 'firecrawl_scrape']));
    await expect(ac.getChatBrowser()).rejects.toThrow('the browser is off');
  });
});
