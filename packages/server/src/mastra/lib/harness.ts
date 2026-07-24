/**
 * # Agent Harness (mastra-chat-kit reference)
 *
 * Wraps the SAME `chatAgent` the Single Agent path uses, but through Mastra's
 * `AgentController` (`@mastra/core/agent-controller` — formerly `Harness`). It
 * adds the orchestration surface a bare agent stream can't carry — sessions/
 * threads, modes, model switching, tool-approval gates (HITL), subagents, tasks,
 * and a canonical display state — emitted as `AgentControllerEvent`s via a
 * session's `subscribe()`.
 *
 * The Single Agent path streams AI SDK v7 `UIMessage` parts over HTTP; the Agent
 * Harness path streams controller events over SSE (see the `/harness/stream`
 * route in `index.ts`). The web layer maps both onto the same AI Elements. See
 * `docs/coverage.md` for the full event → element mapping.
 *
 * Reference scope: a single process-wide controller + one Session (one logical
 * user). Threads keep conversations separate; for true multi-user you'd create a
 * Session per user (keyed by resourceId).
 */

import { AgentController, type Session } from '@mastra/core/agent-controller';
import { InMemoryStore, type MastraStorage } from '@mastra/core/storage';
import { LocalFilesystem, Workspace } from '@mastra/core/workspace';
import { chatAgent } from '../agents/chat';

const CHAT_MODEL_ID = 'anthropic/claude-sonnet-4-6';

/** Fixed resource id for the single logical user this reference serves. */
export const CHAT_RESOURCE_ID = 'chat-kit-user';

/**
 * Build (but don't init) an AgentController around `chatAgent` in a single
 * "default" mode. Tests pass their own `storage` (InMemoryStore) for
 * zero-dependency AIMock runs; the live singleton falls back to an in-memory
 * store.
 */
export function createChatHarness(opts?: {
  storage?: MastraStorage;
  resourceId?: string;
}): AgentController {
  return new AgentController({
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
    resourceId: opts?.resourceId ?? CHAT_RESOURCE_ID,
    // AgentController sessions require a Workspace instance (core 1.52+), and a
    // Workspace needs at least a filesystem/sandbox/skills. A local filesystem is
    // the lightest option; the derived fs tools are approval-gated by the harness
    // (HITL) like any other tool, so nothing runs without an explicit decision.
    workspace: new Workspace({
      id: 'chat-workspace',
      filesystem: new LocalFilesystem({ basePath: './.mastra-workspace' }),
    }),
  });
}

let singleton: AgentController | null = null;
let initPromise: Promise<AgentController> | null = null;

/** Lazily construct + `init()` the process-wide AgentController exactly once. */
export function getChatHarness(): Promise<AgentController> {
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

/**
 * Get-or-create the process-wide Session for the single logical user, so the
 * `/harness/stream` and `/harness/approve` routes drive the SAME session (an
 * approval must resolve on the session that parked at the gate).
 */
export async function getChatSession(): Promise<Session> {
  const controller = await getChatHarness();
  const existing = await controller.getSessionByResource(CHAT_RESOURCE_ID);
  return existing ?? (await controller.createSession({ resourceId: CHAT_RESOURCE_ID }));
}
