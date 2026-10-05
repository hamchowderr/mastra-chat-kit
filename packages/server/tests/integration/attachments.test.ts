import { InMemoryStore } from '@mastra/core/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';

/**
 * An image attached in the composer (the attach button → PromptInput files → the
 * /agent-controller/stream route's `files`, mapped to sendMessage's `files`) reaches
 * the model. The raw provider request is captured on its way to AIMock (AIMock's own
 * journal normalizes messages to text, so it can't show an image block).
 */

// 1×1 red PNG.
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('image attachments (AIMock)', () => {
  it('sends an attached image to the model with the message', async () => {
    // Capture every request body sent to the model provider (AIMock's /v1/messages).
    const sentBodies: string[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/v1/messages') && typeof init?.body === 'string')
        sentBodies.push(init.body);
      return realFetch(input, init);
    });
    const controller = createChatAgentController({
      storage: new InMemoryStore(),
      resourceId: 'u-attach',
      browser: null,
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-attach' });
    // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide
    const events: any[] = [];
    const unsubscribe = session.subscribe((e) => {
      events.push(e);
    });
    await session.thread.create({ title: 'attach' });
    await session.sendMessage({
      content: 'What is in this picture?',
      files: [{ data: RED_PNG, mediaType: 'image/png', filename: 'red.png' }],
    });
    unsubscribe();
    await controller.destroy();

    expect(JSON.stringify(events)).toContain('A small red square.');
    const sent = sentBodies.join('\n');
    // The provider request carried the image itself as an image block, not just its name.
    expect(sent).toContain('What is in this picture?');
    expect(sent).toMatch(/"type":"image"/);
    expect(sent).toContain('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ');
  });
});
