// ──────────────────────────────────────────────────────────────────────────
// Resources the agent produced or works inside, served to the web panels: the
// workspace file tree and file reader (Files panel), the live browser screencast
// (Browser panel), and generated-image bytes.
// ──────────────────────────────────────────────────────────────────────────

import { registerApiRoute } from '@mastra/core/server';
import type { ChatServerDeps } from './types';

export const createWorkspaceRoutes = (deps: ChatServerDeps) => [
  // Serves a generated image's bytes by id (the generateImage tool stashes them
  // so they never enter the model context). Returns { base64, mediaType }.
  registerApiRoute('/images/:id', {
    method: 'GET',
    handler: async (c) => {
      const img = deps.getImage(c.req.param('id'));
      if (!img) {
        return c.json({ error: 'image not found' }, 404);
      }
      return c.json(img);
    },
  }),

  // Workbench Files panel: read the controller agent's workspace (WORKSPACE_ROOT)
  // directly off disk. GET /workspace/files → the file tree; GET /workspace/file
  // ?path=<rel> → one file's text (confined to WORKSPACE_ROOT by the reader).
  registerApiRoute('/workspace/files', {
    method: 'GET',
    handler: async (c) =>
      c.json({ root: deps.workspace.root, tree: await deps.workspace.readTree() }),
  }),
  registerApiRoute('/workspace/file', {
    method: 'GET',
    handler: async (c) => {
      const p = c.req.query('path');
      if (!p) {
        return c.json({ error: 'path query is required' }, 400);
      }
      const file = await deps.workspace.readFile(p);
      if (!file) {
        return c.json({ error: 'not found' }, 404);
      }
      return c.json(file);
    },
  }),

  // Workbench Browser panel: a live screencast (SSE) of the controller agent's Chrome
  // (the @mastra/browser-viewer instance). Launches the browser on first view, then
  // forwards base64 JPEG frames + URL changes; the agent's browser tools drive the
  // SAME window, so the panel shows what the agent sees.
  registerApiRoute('/browser/screencast', {
    method: 'GET',
    handler: async (c) => {
      const browser = await deps.getBrowser();
      try {
        if (!browser.isBrowserRunning()) {
          await browser.launch();
        }
        // A blank launch has no page/target, so CDP screencast emits nothing.
        // ensureReady() gives the browser a page to capture; startScreencast then
        // emits the initial frame, and the agent's navigations produce the rest.
        await browser.ensureReady();
        const stream = await browser.startScreencast({
          format: 'jpeg',
          quality: 70,
          maxWidth: 1280,
          maxHeight: 720,
        });

        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (obj: unknown) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
              } catch {
                /* stream already closed */
              }
            };
            stream.on('frame', (f: { data: string; viewport: unknown }) =>
              send({ type: 'frame', data: f.data, viewport: f.viewport }),
            );
            stream.on('url', (url: string) => send({ type: 'url', url }));
            stream.on('error', (e: unknown) =>
              send({ type: 'error', error: e instanceof Error ? e.message : String(e) }),
            );
            stream.on('stop', (reason: string) => {
              send({ type: 'stop', reason });
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            });
            // `startScreencast()` returns an already-started stream, so listeners
            // are attached here and frames flow immediately.
            // Stop the screencast when the panel disconnects.
            c.req.raw.signal?.addEventListener('abort', () => {
              stream.stop().catch(() => {});
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            });
          },
        });

        return new Response(body, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
          },
        });
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : 'screencast unavailable' },
          503,
        );
      }
    },
  }),
];
