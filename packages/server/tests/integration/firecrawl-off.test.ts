import { InMemoryStore } from '@mastra/core/storage';
import { describe, expect, it, vi } from 'vitest';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';

/**
 * Without FIRECRAWL_API_KEY (the test env sets none) the agent is offered no Firecrawl
 * tool. Its counterpart with the key set is firecrawl.test.ts.
 */
describe('Firecrawl off (no FIRECRAWL_API_KEY)', () => {
  it('a run offers the model no Firecrawl tools', async () => {
    const controller = createChatAgentController({
      storage: new InMemoryStore(),
      resourceId: 'u-firecrawl-off',
      browser: null,
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-firecrawl-off' });

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
    expect(offered.flat().filter((name) => name.startsWith('firecrawl_'))).toEqual([]);
  });
});
