/**
 * # Agent Controller (mastra-chat-kit reference)
 *
 * Drives `chatAgent` through Mastra's `AgentController`
 * (`@mastra/core/agent-controller`). It adds the orchestration surface a bare
 * agent stream can't carry — sessions/threads, modes, model switching,
 * tool-approval gates (HITL), subagents, tasks, and a canonical display state —
 * emitted as `AgentControllerEvent`s via a session's `subscribe()`.
 *
 * Those events stream over SSE (see the `/agent-controller/stream` route in
 * `index.ts`); the web layer maps them onto stock AI Elements. See
 * `docs/coverage.md` for the full event → element mapping.
 *
 * Reference scope: a single process-wide controller + one Session (one logical
 * user). Threads keep conversations separate; for true multi-user you'd create a
 * Session per user (keyed by resourceId).
 */

import type { BrowserViewer } from '@mastra/browser-viewer';
import {
  AgentController,
  type AgentControllerSubagent,
  type Session,
} from '@mastra/core/agent-controller';
import type { MastraBrowser } from '@mastra/core/browser';
import { InMemoryStore, type MastraStorage } from '@mastra/core/storage';
import type { Workspace } from '@mastra/core/workspace';
import { env } from '../../lib/env';
import { chatAgent } from '../agents/chat';
import { codeSubagent } from '../agents/code';
import { dataSubagent } from '../agents/data';
import { researchSubagentFor } from '../agents/research';
import { reviewerSubagent } from '../agents/reviewer';
import { writerSubagent } from '../agents/writer';
import type { ScreencastBrowser } from '../routes/types';
import { type ChatFeatures, features as defaultFeatures } from './features';
import { DISCOVERY_BACKOFF_MS, disconnectFirecrawl, getFirecrawlTools } from './firecrawl';
import { createDefaultMemory, getSharedStore } from './memory';
import { AUTO_ALLOWED_TOOLS, PLAN_MODE_TOOLS, resolveToolCategory } from './tool-categories';
import { withTurnContext } from './turn-context';
import {
  createBrowser,
  createChatWorkspace,
  getChatBrowserInstance,
  getChatWorkspace,
  WORKSPACE_ROOT,
} from './workspace';

// The workspace (filesystem + sandbox + browser) is defined once in ./workspace and
// shared by BOTH the chat agent (Studio visibility, 698.31) and this controller — same
// instance, so nothing is double-provisioned. Re-exported for the /workspace/* routes
// (index.ts, WORKSPACE_ROOT) and the integration test (createBrowser) which import from here.
export { createBrowser, WORKSPACE_ROOT };

const CHAT_MODEL_ID = env.CHAT_MODEL;

/**
 * lib/firecrawl-browser.ts, loaded only when the Firecrawl browser is the browser, so the
 * default setup never loads `@mastra/browser-firecrawl` (agent-browser, webdriverio).
 */
const firecrawlBrowserLib =
  defaultFeatures.browser === 'firecrawl' ? await import('./firecrawl-browser') : null;

/**
 * The resource id of the one shared Session the kit serves by default. With
 * MASTRA_JWT_SECRET set, each signed-in user's id (the proxy's JWT `sub`) is the
 * resource id instead, so every user gets their own Session and threads.
 */
export const CHAT_RESOURCE_ID = 'chat-kit-user';

/**
 * The specialist roster for a set of RESOLVED features (lib/features.ts — `data` is
 * already off without Dolt, `code` without a sandbox, `research` without Firecrawl or
 * a browser). Research reads the web through whichever of those is on, and keeps
 * `searchKnowledge` only while the demo tools are on.
 */
export function chatSubagents(f: ChatFeatures): AgentControllerSubagent[] {
  // Each gets today's date after its own instructions, as the chat agent does.
  return [
    ...(f.subagents.code ? [codeSubagent] : []),
    ...(f.subagents.research ? [researchSubagentFor(f)] : []),
    ...(f.subagents.writer ? [writerSubagent] : []),
    ...(f.subagents.review ? [reviewerSubagent] : []),
    ...(f.subagents.data ? [dataSubagent] : []),
  ].map((subagent) => withTurnContext(subagent));
}

/**
 * Plan mode's extra instructions. Mastra's submit_plan takes the PATH of a plan file the
 * agent wrote (never the plan text), so the agent writes it with the workspace's own
 * write_file tool first.
 */
export const PLAN_MODE_INSTRUCTIONS =
  'You are in PLAN mode. Investigate the request and produce a concise, ordered plan. Write it to a Markdown file under plans/ (e.g. plans/<short-name>.md) with mastra_workspace_write_file, then call submit_plan with that path. Write nothing else and run nothing in this mode — planning only. When the plan is approved, the session switches to Chat mode to execute it.';

/**
 * The live singleton's persistent thread/message store. It MUST be the very same
 * shared store instance the chatAgent's Memory uses (`getSharedStore`) — that's
 * what keeps the controller's `session.thread.list()` reads and the agent's message
 * writes in ONE DB. A separate store (even same URL) risks the agent writing to a
 * different resolved file than the controller reads, leaving the sidebar empty.
 * Tests still pass their own `InMemoryStore` for hermetic AIMock runs.
 */
function createAgentControllerStore(): MastraStorage {
  return getSharedStore();
}

/**
 * Build (but don't init) an AgentController around `chatAgent` in a single
 * "default" mode. Tests pass their own `storage` (InMemoryStore) for
 * zero-dependency AIMock runs; the live singleton falls back to an in-memory
 * store.
 */
export function createChatAgentController(opts?: {
  storage?: MastraStorage;
  resourceId?: string;
  /**
   * Override the browser the features pick (the workspace's viewer, or the controller's
   * Firecrawl browser); pass `null` to omit it (hermetic tests).
   */
  browser?: MastraBrowser | null;
  /**
   * The workspace to drive the session with. The live singleton passes the SHARED
   * workspace (`getChatWorkspace()`) — the same instance the chat agent carries — so
   * nothing is double-provisioned. Omit it (tests) to build a throwaway workspace from
   * the `browser` option instead, keeping AIMock runs hermetic.
   */
  workspace?: Workspace;
}): AgentController {
  const f = defaultFeatures;
  const agent = chatAgent;
  // The viewer lives in the workspace (it is driven through the sandbox); the Firecrawl
  // browser lives on the controller (lib/firecrawl-browser.ts says why).
  const viewer =
    opts?.browser === null || f.browser !== 'viewer'
      ? undefined
      : (opts?.browser ?? createBrowser());
  const firecrawlBrowser =
    opts?.browser === null || f.browser !== 'firecrawl'
      ? undefined
      : (opts?.browser ?? firecrawlBrowserLib?.getFirecrawlBrowser());
  const workspace =
    opts?.workspace ?? createChatWorkspace({ features: f, ...(viewer ? { browser: viewer } : {}) });
  const controller = new AgentController({
    id: 'chat-agent-controller',
    defaultModeId: 'chat',
    // Shared backing agent that EVERY mode forks + decorates. Modes let the one
    // agent switch operating profile (instructions/tool visibility) without
    // swapping agents — the controller surface a plain agent can't express.
    agent,
    // Without a resolver, "always allow" just approves once (Mastra has no default).
    toolCategoryResolver: resolveToolCategory,
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
        instructions: PLAN_MODE_INSTRUCTIONS,
        // Mastra's per-mode allowlist: only the read tools, the plan file's write and
        // submit_plan are visible or runnable here (lib/tool-categories.ts).
        availableTools: [...PLAN_MODE_TOOLS],
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
    // ONE agent, a ROSTER of native specialist subagents: the controller auto-creates
    // the built-in `subagent` tool from these definitions, so the chat agent can spawn a
    // fresh, focused specialist per task — agentType 'code' (build/run in the sandbox),
    // 'research' (browse + search + cite), 'writer' (draft long-form), 'review'
    // (read-only audit), and 'data' (versioned SQL). Each is a real `forked:false`
    // specialist (its own instructions/model/tools); callers may still request a
    // `forked` (self-clone) subagent per-invocation for parallel subtasks.
    //
    // Between them the roster covers the three ways to scope a subagent: inherit the
    // whole workspace (code), narrow it (review — `allowedWorkspaceTools`), or bring
    // tools the parent doesn't have (data — its own `tools`).
    //
    // `data` is CONDITIONAL: Dolt is opt-in and off by default, and a specialist whose
    // every tool call fails against an absent database is worse than no specialist —
    // the subagent tool's auto-generated description would still advertise it.
    //
    // Each specialist has its own switch (SUBAGENT_* — lib/features.ts); with none on,
    // the controller offers no `subagent` tool at all.
    ...(chatSubagents(f).length ? { subagents: chatSubagents(f) } : {}),
    // Firecrawl search + scrape (lib/firecrawl.ts), when FIRECRAWL_API_KEY is set. Tools
    // on the controller reach the chat agent on every run, and the research subagent
    // through its `allowedControllerTools`. Resolved per run, so a Firecrawl outage only
    // costs that run its web search.
    //
    // The interval handler is how the Firecrawl connection gets closed: Mastra's
    // shutdown() (run by the server on SIGINT/SIGTERM) destroys every registered
    // controller, and destroy() calls each handler's `shutdown`. Its tick discovers the
    // tools at init and retries after a failure, so the first message rarely waits.
    //
    // With the Firecrawl browser (BROWSER_PROVIDER=firecrawl, lib/firecrawl-browser.ts) the
    // same shutdown also closes every hosted browser session, so none is left billing.
    ...(f.firecrawl
      ? {
          tools: () => getFirecrawlTools(),
          intervalHandlers: [
            {
              id: 'firecrawl',
              intervalMs: DISCOVERY_BACKOFF_MS,
              handler: async () => {
                await getFirecrawlTools();
              },
              shutdown: async () => {
                try {
                  await disconnectFirecrawl();
                } finally {
                  if (firecrawlBrowser) {
                    await (opts?.browser
                      ? firecrawlBrowser.close()
                      : firecrawlBrowserLib?.closeFirecrawlBrowser());
                  }
                }
              },
            },
          ],
        }
      : {}),
    // The Firecrawl browser: Mastra adds its browser_* tools to the chat agent's toolset.
    // The controller gates each call like any other tool (tool-categories.ts and
    // AUTO_ALLOWED_TOOLS decide which ones skip the card).
    ...(firecrawlBrowser ? { browser: firecrawlBrowser } : {}),
    // A real workspace: filesystem + shell sandbox (both rooted at WORKSPACE_ROOT)
    // + a browser. This gives the agent the full derived tool set — read/write/
    // edit/list/delete/search files, executeCommand (shell), AND browser tools.
    // Every tool is approval-gated by the controller (HITL), so nothing runs without
    // an explicit decision. Live: the SHARED workspace (also on the chat agent).
    workspace,
  });
  // Each run's hosted browser sessions close when the run ends.
  if (firecrawlBrowser) firecrawlBrowserLib?.closeSessionsAtRunEnd(controller, firecrawlBrowser);
  return controller;
}

let singleton: AgentController | null = null;
let singletonBrowser: BrowserViewer | null = null;
let initPromise: Promise<AgentController> | null = null;

let instance: AgentController | null = null;

/**
 * The process-wide AgentController, constructed but NOT initialized. index.ts
 * registers it on the Mastra instance (`agentControllers`) BEFORE `init()` runs.
 *
 * That registration is what keeps tracing alive. An unregistered controller's
 * `init()` builds its own internal Mastra with no observability, and then calls
 * `addAgent(chatAgent)` on it, which moves the shared chatAgent off the app's
 * Mastra. From then on every run on every path (controller SSE and
 * /api/agents/chat/*) creates no spans (mastra-chat-kit-9m3).
 */
export function getChatAgentControllerInstance(): AgentController {
  // Drive the session with the SHARED workspace singleton — the very same instance
  // the chat agent carries (getChatWorkspace), so Studio + the controller + the
  // screencast route all point at one workspace/browser. No double-provision.
  instance ??= createChatAgentController({
    workspace: getChatWorkspace(),
    storage: createAgentControllerStore(),
  });
  return instance;
}

/** Lazily `init()` the process-wide AgentController exactly once. */
export function getChatAgentController(): Promise<AgentController> {
  if (singleton) {
    return Promise.resolve(singleton);
  }
  if (!initPromise) {
    initPromise = (async () => {
      const controller = getChatAgentControllerInstance();
      await controller.init();
      singleton = controller;
      // The screencast route reaches the same Chrome the agent's browser tools drive.
      if (defaultFeatures.browser === 'viewer') singletonBrowser = getChatBrowserInstance();
      return controller;
    })();
  }
  return initPromise;
}

/**
 * What the `/browser/screencast` route streams for a user (a resource id; undefined is
 * the shared user). With the viewer: the process-wide `BrowserViewer` backing the
 * controller workspace, the same Chrome the agent drives. With the Firecrawl browser: the
 * hosted session of the user's current thread (firecrawlLiveView).
 */
export async function getChatBrowser(resourceId?: string): Promise<ScreencastBrowser> {
  if (!defaultFeatures.browser) {
    throw new Error(
      'the browser is off (WORKSPACE_BROWSER, or what its provider needs is missing: the sandbox for viewer, FIRECRAWL_API_KEY for firecrawl)',
    );
  }
  const controller = await getChatAgentController();
  if (firecrawlBrowserLib) {
    const session = await controller.getSessionByResource(resourceId ?? CHAT_RESOURCE_ID);
    return firecrawlBrowserLib.firecrawlLiveView(
      firecrawlBrowserLib.getFirecrawlBrowser(),
      session?.thread.getId(),
    );
  }
  if (!singletonBrowser) {
    throw new Error('chat browser not initialized');
  }
  return singletonBrowser;
}

// Tools every session runs without an approval card (lib/tool-categories.ts says why).
export { AUTO_ALLOWED_TOOLS };

/**
 * Get-or-create the Session for one user (a resource id), so the
 * `/agent-controller/stream` and `/agent-controller/approve` routes drive the SAME session (an
 * approval must resolve on the session that parked at the gate). Without auth every
 * request is the one shared user, `CHAT_RESOURCE_ID`.
 */
export async function getChatSession(resourceId: string = CHAT_RESOURCE_ID): Promise<Session> {
  const controller = await getChatAgentController();
  const existing = await controller.getSessionByResource(resourceId);
  const session = existing ?? (await controller.createSession({ resourceId }));
  // In-memory + idempotent, so re-granting each call is free.
  for (const tool of AUTO_ALLOWED_TOOLS) {
    session.grantTool(tool);
  }
  return session;
}
