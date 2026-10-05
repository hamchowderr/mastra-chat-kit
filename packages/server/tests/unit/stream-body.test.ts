import { describe, expect, it, vi } from 'vitest';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  STREAM_BODY_LIMIT,
  streamBodyLimit,
} from '../../src/mastra/routes/stream-body';
import { ctx, deps, find } from '../helpers/route-harness';

/**
 * What POST /agent-controller/stream refuses before it touches the session: a body of
 * the wrong shape, attachments that are not inline data URLs of an allowed type, too
 * many or too large files, and an oversized body. Every refusal is a 400 (or a 413 for
 * the body cap), never a 500, and never a call to getSession.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

async function post(body: unknown) {
  const getSession = vi.fn(() => Promise.reject(new Error('must not be called')));
  const route = find(
    createControllerRoutes(deps({ getSession })),
    '/agent-controller/stream',
    'POST',
  );
  const { c, captured } = ctx({ body });
  await route.handler(c).catch((err) => {
    captured.status = 500;
    captured.body = String(err);
  });
  return {
    status: captured.status,
    error: (captured.body as { error?: string })?.error,
    getSession,
  };
}

/** A base64 payload that decodes to at most `bytes` bytes (within 2 of it). */
const payloadOf = (bytes: number) => 'A'.repeat(Math.floor(bytes / 3) * 4);

describe('/agent-controller/stream body checks', () => {
  it.each([
    ['no text and no files', { files: [] }],
    ['whitespace-only text and no files', { text: '   \n' }],
    ['files as a string', { text: 'hi', files: 'nope' }],
    ['text as a number', { text: 42 }],
    ['no body at all', undefined],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.getSession).not.toHaveBeenCalled();
  });

  it.each([
    ['an http URL', 'http://169.254.169.254/latest/meta-data'],
    ['an https URL', 'https://example.com/cat.png'],
    ['a blob URL', 'blob:http://localhost/123'],
    ['a file URL', 'file:///etc/passwd'],
    ['a data URL that is not base64', 'data:image/png,hello'],
  ])('rejects a file given as %s', async (_label, url) => {
    const res = await post({ text: 'look', files: [{ url, mediaType: 'image/png' }] });
    expect(res.status).toBe(400);
    expect(res.getSession).not.toHaveBeenCalled();
  });

  it('rejects a media type that is not allowed', async () => {
    const url = 'data:text/html;base64,PGgxPmhpPC9oMT4=';
    const res = await post({ text: 'look', files: [{ url, mediaType: 'text/html' }] });
    expect(res.status).toBe(400);
  });

  it('rejects a data URL whose type differs from mediaType', async () => {
    const url = 'data:application/x-msdownload;base64,TVqQ';
    const res = await post({ text: 'look', files: [{ url, mediaType: 'image/png' }] });
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/does not match/);
  });

  it(`rejects more than ${MAX_ATTACHMENTS} files`, async () => {
    const files = Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({
      url: PNG,
      mediaType: 'image/png',
    }));
    const res = await post({ text: 'look', files });
    expect(res.status).toBe(400);
  });

  it('rejects a file over the size cap, and accepts one at it', async () => {
    const over = `data:image/png;base64,${payloadOf(MAX_ATTACHMENT_BYTES + 3)}`;
    expect((await post({ files: [{ url: over, mediaType: 'image/png' }] })).status).toBe(400);

    const at = `data:image/png;base64,${payloadOf(MAX_ATTACHMENT_BYTES)}`;
    const ok = await post({ files: [{ url: at, mediaType: 'image/png' }] });
    // Valid: it got as far as asking for the session (which this test refuses).
    expect(ok.getSession).toHaveBeenCalled();
  });

  it('caps the body size before reading it, with a 413', async () => {
    const { Hono } = await import('hono');
    const app = new Hono().post('/s', streamBodyLimit, (c) => c.json({ ok: true }));
    const big = 'x'.repeat(STREAM_BODY_LIMIT + 1);
    const res = await app.request('/s', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(big.length) },
      body: big,
    });
    expect(res.status).toBe(413);
    const small = await app.request('/s', { method: 'POST', body: '{}' });
    expect(small.status).toBe(200);
  });

  it('registers the body cap on the stream route', () => {
    const route = find(createControllerRoutes(deps()), '/agent-controller/stream', 'POST') as {
      middleware?: unknown;
    };
    expect(route.middleware).toBe(streamBodyLimit);
  });
});
