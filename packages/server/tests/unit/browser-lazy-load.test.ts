import { describe, expect, it, vi } from 'vitest';

// If anything imports the Firecrawl browser provider, this file fails to load it.
vi.mock('@mastra/browser-firecrawl', () => {
  throw new Error('@mastra/browser-firecrawl was loaded');
});

/**
 * The default setup (no Firecrawl key, the sandbox on, so the `viewer` browser) never
 * loads `@mastra/browser-firecrawl` and what it pulls in (agent-browser, webdriverio):
 * lib/agent-controller.ts imports lib/firecrawl-browser.ts only for that provider.
 */
describe('the Firecrawl browser is loaded only when it is the browser', () => {
  it('building the default controller does not load it', async () => {
    const { features } = await import('../../src/mastra/lib/features');
    expect(features.browser).toBe('viewer');
    const ac = await import('../../src/mastra/lib/agent-controller');
    const { InMemoryStore } = await import('@mastra/core/storage');
    const controller = ac.createChatAgentController({
      storage: new InMemoryStore(),
      browser: null,
    });
    expect(controller).toBeDefined();
    expect(ac.AUTO_ALLOWED_TOOLS).toContain('browser_snapshot');
  });
});
