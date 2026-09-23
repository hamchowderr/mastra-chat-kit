import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';
import { createDefaultMemory, getSharedStore } from '../../src/mastra/lib/memory';

/**
 * Memory reaches ACROSS threads for one resource (the kit's two resource-scoped
 * settings: semantic recall and working memory). Asked of Mastra's Memory API
 * directly, so nothing depends on how a model would use the recalled text.
 *
 * The controller runs on the SHARED libSQL store, as it does live, so the threads
 * the session creates are the ones Memory reads. Embeddings are local (fastembed),
 * so this costs nothing. A fresh resourceId per run keeps earlier runs' messages
 * in mastra-test.db out of the results.
 */
describe('memory across threads (one resource)', () => {
  it('recalls a fact said in thread A from thread B', async () => {
    const resourceId = `u-mem-${randomUUID()}`;
    const controller = createChatAgentController({ storage: getSharedStore(), resourceId });
    await controller.init();
    const session = await controller.createSession({ resourceId });

    await session.thread.create({ title: 'thread A' });
    await session.sendMessage({ content: 'My favorite color is teal.' });

    await session.thread.create({ title: 'thread B' });
    const threadB = session.thread.requireId();
    await controller.destroy();

    const { messages } = await createDefaultMemory().recall({
      threadId: threadB,
      resourceId,
      vectorSearchString: 'What is my favorite color?',
    });

    expect(JSON.stringify(messages)).toContain('favorite color is teal');

    // And it stays inside the resource: another user's thread recalls nothing of it.
    const other = `u-mem-other-${randomUUID()}`;
    const otherThread = await createDefaultMemory().createThread({ resourceId: other });
    const { messages: leaked } = await createDefaultMemory().recall({
      threadId: otherThread.id,
      resourceId: other,
      vectorSearchString: 'What is my favorite color?',
    });
    expect(JSON.stringify(leaked)).not.toContain('teal');
  });

  it('shares working memory between threads', async () => {
    const resourceId = `u-wm-${randomUUID()}`;
    const memory = createDefaultMemory();
    const threadA = await memory.createThread({ resourceId, title: 'A' });
    const threadB = await memory.createThread({ resourceId, title: 'B' });

    await memory.updateWorkingMemory({
      threadId: threadA.id,
      resourceId,
      workingMemory: '# User\n- Name: Sam',
    });

    expect(await memory.getWorkingMemory({ threadId: threadB.id, resourceId })).toContain(
      'Name: Sam',
    );
  });
});
