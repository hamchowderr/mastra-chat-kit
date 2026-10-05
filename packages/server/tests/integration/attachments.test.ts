import { InMemoryStore } from '@mastra/core/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import type { ChatServerDeps } from '../../src/mastra/routes/types';
import { ctx, deps, find } from '../helpers/route-harness';

/**
 * An image attached in the composer reaches the model. The test posts the body the web
 * hook sends (`files: [{ url, mediaType, filename }]`, `url` a data URL) to the real
 * /agent-controller/stream route, backed by a real AgentController session on AIMock.
 * The raw provider request is captured on its way to AIMock (AIMock's own journal
 * normalizes messages to text, so it can't show an image block).
 */

// 1×1 red PNG.
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const PNG_BYTES = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

afterEach(() => {
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

describe('image attachments (AIMock)', () => {
  it('sends an attached image to the model with the message, through the stream route', async () => {
    const sent = captureProviderRequests();
    const { status, text } = await postStream('u-attach', {
      text: 'What is in this picture?',
      files: [{ url: RED_PNG, mediaType: 'image/png', filename: 'red.png' }],
    });

    expect(status).toBe(200);
    expect(text).toContain('A small red square.');
    const body = sent.join('\n');
    // The provider request carried the image itself as an image block, not just its name.
    expect(body).toContain('What is in this picture?');
    expect(body).toMatch(/"type":"image"/);
    expect(body).toContain(PNG_BYTES);
  });

  it('sends an image with no text', async () => {
    const sent = captureProviderRequests();
    const { status } = await postStream('u-attach-only', {
      text: '',
      files: [{ url: RED_PNG, mediaType: 'image/png', filename: 'red.png' }],
    });

    expect(status).toBe(200);
    const body = sent.join('\n');
    expect(body).toMatch(/"type":"image"/);
    expect(body).toContain(PNG_BYTES);
  });
});
