import { expect, test } from '@playwright/test';

/**
 * Users and auth, end to end (run with E2E_AUTH=1; see playwright.config.ts). With
 * MASTRA_JWT_SECRET on both sides, the Mastra server refuses a request that did not come
 * through the web proxy, and the proxy's signed requests work — the rest of the suite
 * (chat.spec.ts) then runs entirely over the signed path.
 */
test.skip(!process.env.E2E_AUTH, 'auth e2e runs with E2E_AUTH=1');

const SERVER_URL =
  process.env.MASTRA_SERVER_URL ?? `http://127.0.0.1:${process.env.E2E_SERVER_PORT ?? 4111}`;

test('the server refuses an unsigned request', async ({ request }) => {
  const res = await request.get(`${SERVER_URL}/agent-controller/threads`);
  expect(res.status()).toBe(401);
});

test('the proxy signs its requests', async ({ request }) => {
  const res = await request.get('/api/agent-controller/threads');
  expect(res.status()).toBe(200);
  expect(await res.json()).toHaveProperty('threads');
});
