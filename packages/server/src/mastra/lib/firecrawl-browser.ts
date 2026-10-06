import { FirecrawlBrowser } from '@mastra/browser-firecrawl';
import type { AgentController, Session } from '@mastra/core/agent-controller';
import type { MastraBrowser } from '@mastra/core/browser';
import { env } from '../../lib/env';
import type { ScreencastBrowser } from '../routes/types';

/**
 * # Firecrawl hosted browser (BROWSER_PROVIDER=firecrawl)
 *
 * `@mastra/browser-firecrawl`'s FirecrawlBrowser: a Mastra SDK browser provider that
 * creates Firecrawl Browser Sandbox sessions through Firecrawl's API and drives them over
 * CDP with the same tools as `@mastra/agent-browser` (browser_goto, browser_snapshot,
 * browser_click, …). The browser runs at Firecrawl, so the host needs no Chrome and no
 * sandbox. The tools come from the provider itself (`getTools()`), unlike
 * `@mastra/browser-viewer`, which has none and is driven through execute_command.
 *
 * It sits on the AgentController's `browser` (lib/agent-controller.ts), not in the
 * workspace. Mastra gives a workspace's browser to every agent built with that workspace,
 * and the controller runs subagents with `requireToolApproval: false`, so a workspace
 * browser would let the writer, review and research subagents click and type with no
 * approval. On the controller it reaches only the chat agent, where the controller gates
 * every call.
 *
 * Sessions are per conversation thread (`scope: 'thread'`, the provider's default), so no
 * two threads or users share a page. Each one costs Firecrawl credits while it is open
 * (billed per browser minute), so:
 * - a run's sessions are closed when the run ends (closeSessionsAtRunEnd);
 * - every session is closed when the server shuts down (the controller's interval
 *   handler calls closeFirecrawlBrowser);
 * - Firecrawl itself ends a session after FIRECRAWL_BROWSER_TTL seconds, or
 *   FIRECRAWL_BROWSER_IDLE_TTL seconds without activity, in case neither of those runs.
 */

/**
 * Tools the provider is built without. browser_evaluate runs arbitrary JavaScript in the
 * page; the other tools cover what the agent needs, so it is not offered at all
 * (`excludeTools`, the provider's own option). The tool names and their approval rules
 * are in lib/tool-categories.ts.
 */
export const EXCLUDED_BROWSER_TOOLS = ['browser_evaluate'] as const;

/** A FirecrawlBrowser with the kit's session settings. */
export function createFirecrawlBrowser({
  apiKey,
  apiUrl,
  ttl,
  activityTtl,
}: {
  apiKey: string;
  apiUrl: string;
  /** Firecrawl's `ttl`: a session's maximum lifetime, in seconds. */
  ttl: number;
  /** Firecrawl's `activityTtl`: idle seconds before Firecrawl ends a session. */
  activityTtl: number;
}): FirecrawlBrowser {
  return new FirecrawlBrowser({
    apiKey,
    apiUrl,
    scope: 'thread',
    excludeTools: [...EXCLUDED_BROWSER_TOOLS],
    firecrawl: { ttl, activityTtl },
  });
}

let instance: FirecrawlBrowser | null = null;

/** The live server's FirecrawlBrowser (from FIRECRAWL_API_KEY / FIRECRAWL_API_URL). */
export function getFirecrawlBrowser(): FirecrawlBrowser {
  if (!env.FIRECRAWL_API_KEY) {
    throw new Error('the Firecrawl browser needs FIRECRAWL_API_KEY');
  }
  instance ??= createFirecrawlBrowser({
    apiKey: env.FIRECRAWL_API_KEY,
    apiUrl: env.FIRECRAWL_API_URL,
    ttl: env.FIRECRAWL_BROWSER_TTL,
    activityTtl: env.FIRECRAWL_BROWSER_IDLE_TTL,
  });
  return instance;
}

/**
 * Close the browser sessions a session's run opened: the run's own thread, plus any
 * forked subagent thread of the same user (a forked subagent is the chat agent on a
 * cloned thread, so its browser calls open a session under that thread's id).
 */
export async function closeRunSessions(
  controller: AgentController,
  session: Session,
  browser: MastraBrowser,
): Promise<void> {
  const threadIds = new Set<string>();
  const current = session.thread.getId();
  if (current) threadIds.add(current);
  try {
    const threads = await controller.queryThreads({
      resourceId: session.identity.getResourceId(),
      includeForkedSubagents: true,
    });
    for (const thread of threads) threadIds.add(thread.id);
  } catch (err) {
    // Still close the run's own thread; a forked thread's session falls to the idle TTL.
    console.warn(`Listing threads to close their browser sessions failed: ${err}`);
  }
  await Promise.all(
    [...threadIds]
      .filter((id) => browser.hasThreadSession(id) && browser.isBrowserRunning(id))
      .map((id) => browser.closeThreadSession(id)),
  );
}

/**
 * Close a run's browser sessions when the run ends. Uses the session's before-agent-end
 * hook, so the sessions are closed before the client sees `agent_end` and before the next
 * message can start a run. A run that ends `suspended` (parked on an approval or a
 * question) keeps its session, so the page is still there when it resumes; the idle TTL
 * bounds one that is never resumed. Registered as a blocking onSessionCreated listener,
 * so it is in place before a new session's first run.
 */
export function closeSessionsAtRunEnd(
  controller: AgentController,
  browser: MastraBrowser,
): () => void {
  return controller.onSessionCreated(
    (session) => {
      session.onBeforeAgentEnd(async (event) => {
        if (event.reason === 'suspended') return;
        try {
          await closeRunSessions(controller, session, browser);
        } catch (err) {
          console.warn(`Closing Firecrawl browser sessions failed: ${err}`);
        }
      });
    },
    { blocking: true },
  );
}

/**
 * Close every session of the live browser. The controller calls it from its shutdown
 * hook (lib/agent-controller.ts), which Mastra runs on SIGINT/SIGTERM.
 */
export async function closeFirecrawlBrowser(): Promise<void> {
  const open = instance;
  instance = null;
  await open?.close();
}

/**
 * What the Browser panel's `/browser/screencast` route streams for one conversation
 * thread. The provider's own screencast (`startScreencast`, CDP Page.startScreencast over
 * the hosted session's CDP connection) is used as is. Opening the panel never creates a
 * session, since that would bill Firecrawl minutes for a page nobody asked for: with no
 * session on the thread, `launch()` fails and the route answers 503 until the agent
 * opens the browser.
 */
export function firecrawlLiveView(
  browser: MastraBrowser,
  threadId: string | null | undefined,
): ScreencastBrowser {
  const open = () =>
    Boolean(threadId) &&
    browser.hasThreadSession(threadId as string) &&
    browser.isBrowserRunning(threadId as string);
  return {
    provider: browser.provider,
    isBrowserRunning: open,
    launch: async () => {
      throw new Error('the agent has not opened the browser in this conversation yet');
    },
    ensureReady: async () => {
      if (!open()) throw new Error('the browser session for this conversation has closed');
    },
    startScreencast: (opts) => browser.startScreencast({ ...opts, threadId: threadId as string }),
  };
}
