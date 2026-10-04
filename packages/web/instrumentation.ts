// The demo app's hook into the chat proxy (lib/mastra-proxy.ts → configureChatKitProxy).
//
// The demo has no sign-in, so by default it configures nothing and runs as the one
// shared user. The e2e suite (playwright.config.ts, E2E_AUTH=1) sets
// CHAT_KIT_E2E_USER_HEADER=1 so each test can say which user it is with an
// `x-e2e-user` header, proving users are kept apart end to end. Never set that in a
// real deployment: it trusts a header the browser sends. A real host reads its own
// session here instead — see docs/registry.md → "Users and auth".
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.CHAT_KIT_E2E_USER_HEADER !== '1') return;
  const { configureChatKitProxy } = await import('@/lib/mastra-proxy');
  configureChatKitProxy({ getUserId: (request) => request.headers.get('x-e2e-user') });
}
