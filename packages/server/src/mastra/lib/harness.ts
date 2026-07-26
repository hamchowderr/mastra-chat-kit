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

import path from 'node:path';
import { BrowserViewer } from '@mastra/browser-viewer';
import { AgentController, type Session } from '@mastra/core/agent-controller';
import type { MastraBrowser } from '@mastra/core/browser';
import { InMemoryStore, type MastraStorage } from '@mastra/core/storage';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';
import { env } from '../../lib/env';
import { chatAgent } from '../agents/chat';
import { codeSubagent } from '../agents/code';
import { createDefaultMemory, getSharedStore } from './memory';

const CHAT_MODEL_ID = env.CHAT_MODEL;

// Absolute root for the agent's workspace (filesystem + sandbox share it). Under
// `mastra dev` the cwd shifts, so resolve a relative WORKSPACE_ROOT once here.
// Exported so the /workspace/* routes can read the same folder the agent works in.
export const WORKSPACE_ROOT = path.isAbsolute(env.WORKSPACE_ROOT)
  ? env.WORKSPACE_ROOT
  : path.resolve(process.cwd(), env.WORKSPACE_ROOT);

/** Fixed resource id for the single logical user this reference serves. */
export const CHAT_RESOURCE_ID = 'chat-kit-user';

/**
 * The live singleton's persistent thread/message store. It MUST be the very same
 * shared store instance the chatAgent's Memory uses (`getSharedStore`) — that's
 * what keeps the harness's `session.thread.list()` reads and the agent's message
 * writes in ONE DB. A separate store (even same URL) risks the agent writing to a
 * different resolved file than the harness reads, leaving the sidebar empty.
 * Tests still pass their own `InMemoryStore` for hermetic AIMock runs.
 */
function createHarnessStore(): MastraStorage {
  return getSharedStore();
}

/**
 * Build the workspace's browser: a `BrowserViewer` (a `MastraBrowser`) that owns
 * a Playwright-driven Chrome and injects its CDP URL into the CLI the agent
 * shells out to (`agent-browser` by default), so shell-driven and native browser
 * tools drive the SAME window. Construction is cheap — Chrome launches lazily on
 * first use, so this stays off the boot/AIMock/test path until a browser tool
 * actually fires. Pass `browser: null` to `createChatHarness` to opt out.
 */
export function createBrowser(): BrowserViewer {
  return new BrowserViewer({
    cli: env.BROWSER_CLI,
    headless: env.BROWSER_HEADLESS,
    ...(env.BROWSER_EXECUTABLE_PATH ? { executablePath: env.BROWSER_EXECUTABLE_PATH } : {}),
  });
}

/**
 * Build (but don't init) an AgentController around `chatAgent` in a single
 * "default" mode. Tests pass their own `storage` (InMemoryStore) for
 * zero-dependency AIMock runs; the live singleton falls back to an in-memory
 * store.
 */
export function createChatHarness(opts?: {
  storage?: MastraStorage;
  resourceId?: string;
  /** Override the workspace browser; pass `null` to omit it (hermetic tests). */
  browser?: MastraBrowser | null;
}): AgentController {
  const browser = opts?.browser === null ? undefined : (opts?.browser ?? createBrowser());
  return new AgentController({
    id: 'chat-harness',
    defaultModeId: 'chat',
    // Shared backing agent that EVERY mode forks + decorates. Modes let the one
    // agent switch operating profile (instructions/tool visibility) without
    // swapping agents — the harness surface a plain agent can't express.
    agent: chatAgent,
    modes: [
      {
        id: 'chat',
        name: 'Chat',
        description: 'General assistant — full tools, can delegate to subagents.',
        defaultModelId: CHAT_MODEL_ID,
      },
      {
        id: 'plan',
        name: 'Plan',
        description: 'Research and propose a plan; approving it switches to Chat to execute.',
        defaultModelId: CHAT_MODEL_ID,
        // Layered ABOVE the backing agent's own instructions for this mode only.
        instructions:
          'You are in PLAN mode. Investigate the request and produce a concise, ordered plan, then call submit_plan with it. Do NOT create, edit, or run anything in this mode — planning only. When the plan is approved, the session switches to Chat mode to execute it.',
        // submit_plan approval in this mode flips the session to `chat` (plan→build).
        transitionsTo: 'chat',
      },
    ],
    storage: opts?.storage ?? new InMemoryStore(),
    resourceId: opts?.resourceId ?? CHAT_RESOURCE_ID,
    // Controller-level memory (shared across modes + subagents). REQUIRED for
    // subagents: a spawned subagent has no memory of its own, and Mastra's
    // controller-injected state-signal processors (`browser-context`) call
    // `computeStateSignal`, which needs memory + an active resourceId/threadId —
    // without this the subagent run fails ("requires Mastra memory with an active
    // resourceId and threadId").
    memory: createDefaultMemory(),
    // ONE agent, native subagents: the controller auto-creates the built-in
    // `subagent` tool from these definitions, so the chat agent can spawn a fresh
    // focused subagent per task (agentType:'code'). Callers may also request a
    // `forked` (self-clone) subagent per-invocation for ad-hoc parallel subtasks.
    subagents: [codeSubagent],
    // A real workspace: filesystem + shell sandbox (both rooted at WORKSPACE_ROOT)
    // + a browser. This gives the agent the full derived tool set — read/write/
    // edit/list/delete/search files, executeCommand (shell), AND browser tools.
    // Every tool is approval-gated by the harness (HITL), so nothing runs without
    // an explicit decision.
    workspace: new Workspace({
      id: 'chat-workspace',
      filesystem: new LocalFilesystem({ basePath: WORKSPACE_ROOT }),
      sandbox: new LocalSandbox({ workingDirectory: WORKSPACE_ROOT }),
      ...(browser ? { browser } : {}),
    }),
  });
}

let singleton: AgentController | null = null;
let singletonBrowser: BrowserViewer | null = null;
let initPromise: Promise<AgentController> | null = null;

/** Lazily construct + `init()` the process-wide AgentController exactly once. */
export function getChatHarness(): Promise<AgentController> {
  if (singleton) {
    return Promise.resolve(singleton);
  }
  if (!initPromise) {
    initPromise = (async () => {
      // Create the browser explicitly so the screencast route can reach the same
      // instance the agent's browser tools drive.
      const browser = createBrowser();
      // Persistent store → the session's threads/messages survive restarts, so
      // the conversation sidebar can list + reopen them (`session.thread.list()`).
      const harness = createChatHarness({ browser, storage: createHarnessStore() });
      await harness.init();
      singleton = harness;
      singletonBrowser = browser;
      return harness;
    })();
  }
  return initPromise;
}

/**
 * The process-wide `BrowserViewer` backing the harness workspace — the same Chrome
 * the agent drives. The `/browser/screencast` route uses it to stream frames.
 */
export async function getChatBrowser(): Promise<BrowserViewer> {
  await getChatHarness();
  if (!singletonBrowser) {
    throw new Error('chat browser not initialized');
  }
  return singletonBrowser;
}

/**
 * Get-or-create the process-wide Session for the single logical user, so the
 * `/harness/stream` and `/harness/approve` routes drive the SAME session (an
 * approval must resolve on the session that parked at the gate).
 */
export async function getChatSession(): Promise<Session> {
  const controller = await getChatHarness();
  const existing = await controller.getSessionByResource(CHAT_RESOURCE_ID);
  const session = existing ?? (await controller.createSession({ resourceId: CHAT_RESOURCE_ID }));
  // Auto-allow the harness's informational, side-effect-free interaction tools so they
  // never raise a (redundant, confusing) approval gate:
  //  - ask_user — the answer prompt IS the interaction; without this the user would
  //    first approve "Run ask_user?" (showing the question as raw args), THEN the prompt.
  //  - task_write/update/complete/check — pure progress tracking that drives the <Task>
  //    element; gating them makes the user approve "task_write" before seeing a to-do list.
  //  - list_schedules — read-only view of existing schedules (the schedules panel + the
  //    agent answering "what's scheduled?"). Its mutating siblings start_schedule /
  //    stop_schedule stay GATED: creating a recurring background run is a real side effect,
  //    so it flows through the approval gate (an intentional HITL demo).
  // Everything with a real side effect (fs writes, shell, browser, subagents, start/stop
  // schedule) stays gated. In-memory + idempotent, so re-granting each call is free.
  for (const tool of [
    'ask_user',
    'task_write',
    'task_update',
    'task_complete',
    'task_check',
    'list_schedules',
  ]) {
    session.grantTool(tool);
  }
  return session;
}
