/**
 * # Agent Harness (mastra-chat-kit reference)
 *
 * Wraps the SAME `chatAgent` the Single Agent path uses, but through the Mastra
 * Harness (`@mastra/core/harness`). The Harness adds the orchestration surface a
 * bare agent stream can't carry — sessions/threads, modes, model switching,
 * tool-approval gates (HITL), subagents, tasks, and a canonical display state —
 * emitted as `HarnessEvent`s via `subscribe()`.
 *
 * The Single Agent path streams AI SDK v6 `UIMessage` parts over HTTP; the Agent
 * Harness path streams `HarnessEvent`s over SSE (see the `/harness/stream` route
 * in `index.ts`). The web layer maps both onto the same AI Elements. See
 * `docs/coverage.md` for the full event → element mapping.
 *
 * Reference scope: a single process-wide Harness (one logical user). Threads keep
 * conversations separate; for true multi-user you'd key a Harness per session.
 */

import { Harness } from '@mastra/core/harness';
import { InMemoryStore, type MastraStorage } from '@mastra/core/storage';
import { chatAgent } from '../agents/chat';

const CHAT_MODEL_ID = 'anthropic/claude-sonnet-4-6';

/**
 * Build (but don't init) a Harness around `chatAgent` in a single "default" mode.
 * Tests pass their own `storage` (InMemoryStore) for zero-dependency AIMock runs;
 * the live singleton falls back to an in-memory store.
 */
export function createChatHarness(opts?: {
  storage?: MastraStorage;
  resourceId?: string;
}): Harness {
  return new Harness({
    id: 'chat-harness',
    defaultModeId: 'default',
    modes: [
      {
        id: 'default',
        name: 'Default',
        description: 'General conversational assistant.',
        agent: chatAgent,
        defaultModelId: CHAT_MODEL_ID,
      },
    ],
    storage: opts?.storage ?? new InMemoryStore(),
    resourceId: opts?.resourceId ?? 'chat-kit-user',
  });
}

let singleton: Harness | null = null;
let initPromise: Promise<Harness> | null = null;

/** Lazily construct + `init()` the process-wide Harness exactly once. */
export function getChatHarness(): Promise<Harness> {
  if (singleton) {
    return Promise.resolve(singleton);
  }
  if (!initPromise) {
    initPromise = (async () => {
      const harness = createChatHarness();
      await harness.init();
      singleton = harness;
      return harness;
    })();
  }
  return initPromise;
}
