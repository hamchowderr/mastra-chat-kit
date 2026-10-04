import { InMemoryStore } from '@mastra/core/storage';
import { describe, expect, it } from 'vitest';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';

/**
 * One Session per user (resource id) on one AgentController, on AIMock. This is what
 * the routes rely on when the server runs with auth: each signed-in user gets their own
 * Session, and `session.thread.list()` — which the routes use to check ownership —
 * returns only that user's threads.
 */
describe('a Session per user (AIMock)', () => {
  it("keeps each user's threads to themselves", async () => {
    const controller = createChatAgentController({
      storage: new InMemoryStore(),
      browser: null,
    });
    await controller.init();
    const alice = await controller.createSession({ resourceId: 'alice' });
    const bob = await controller.createSession({ resourceId: 'bob' });

    await alice.thread.create({ title: 'alice' });
    await alice.sendMessage({ content: 'Hello' });
    const aliceThread = alice.thread.requireId();
    await bob.thread.create({ title: 'bob' });
    const bobThread = bob.thread.requireId();

    const aliceIds = (await alice.thread.list()).map((t) => t.id);
    const bobIds = (await bob.thread.list()).map((t) => t.id);
    expect(await controller.getSessionByResource('alice')).toBe(alice);
    await controller.destroy();

    expect(aliceIds).toContain(aliceThread);
    expect(aliceIds).not.toContain(bobThread);
    expect(bobIds).toContain(bobThread);
    expect(bobIds).not.toContain(aliceThread);
  });
});
