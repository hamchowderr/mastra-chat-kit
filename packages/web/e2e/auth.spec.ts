import { expect, test } from '@playwright/test';

/**
 * Users and auth, end to end (run with E2E_AUTH=1; see playwright.config.ts). The same
 * MASTRA_JWT_SECRET is on both sides and the demo's instrumentation.ts takes the user
 * from an `x-e2e-user` header, so this drives the real path: the proxy signs the user
 * into the token's `sub`, the server maps it to the resource id, and each user gets
 * their own Session. The rest of the suite (chat.spec.ts) then runs as one user over
 * the signed path.
 */
test.skip(!process.env.E2E_AUTH, 'auth e2e runs with E2E_AUTH=1');

const SERVER_URL =
  process.env.MASTRA_SERVER_URL ?? `http://127.0.0.1:${process.env.E2E_SERVER_PORT ?? 4111}`;

test('the server refuses an unsigned request', async ({ playwright }) => {
  const api = await playwright.request.newContext();
  const res = await api.get(`${SERVER_URL}/agent-controller/threads`);
  expect(res.status()).toBe(401);
  await api.dispose();
});

test('the proxy refuses a request with no user', async ({ baseURL }) => {
  // Plain fetch: Playwright's request contexts inherit the suite's x-e2e-user header.
  const res = await fetch(`${baseURL}/api/agent-controller/threads`);
  expect(res.status).toBe(401);
});

test('each user sees only their own threads', async ({ playwright, baseURL }) => {
  const as = (user: string) =>
    playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'x-e2e-user': user } });
  const alice = await as('e2e-alice');
  const bob = await as('e2e-bob');

  // Alice chats; the stream's prelude names the thread it created.
  const stream = await alice.post('/api/agent-controller/stream', { data: { text: 'Hello' } });
  expect(stream.status()).toBe(200);
  const threadId = /"threadId":"([^"]+)"/.exec(await stream.text())?.[1];
  expect(threadId).toBeTruthy();

  const ids = async (ctx: typeof alice) =>
    (
      (await (await ctx.get('/api/agent-controller/threads')).json()).threads as { id: string }[]
    ).map((t) => t.id);
  expect(await ids(alice)).toContain(threadId);
  expect(await ids(bob)).not.toContain(threadId);

  // Bob can't read or resume Alice's thread.
  const read = await bob.get(`/api/agent-controller/threads/${threadId}/messages`);
  expect(read.status()).toBe(404);
  const resume = await bob.post('/api/agent-controller/stream', {
    data: { text: 'Hi', threadId },
  });
  expect(resume.status()).toBe(404);

  await alice.dispose();
  await bob.dispose();
});
