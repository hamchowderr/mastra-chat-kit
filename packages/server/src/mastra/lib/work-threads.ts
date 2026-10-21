/**
 * # Work threads: one main chat that hands pieces of work to threads of their own
 *
 * The agent in the main chat calls `start_thread` with a title and a brief. That makes a
 * new thread for the same user, runs the agent on the brief there in the background, and
 * returns at once, so the main chat stays free. The thread runs on a Session of its own
 * (scope `work:<threadId>`), never the user's, because a Session drives one thread at a
 * time.
 *
 * The thread's state lives in its metadata (`workThread`: parent, title, status), so the
 * thread list can show it. When a background run finishes, fails, or stops for the user
 * (an approval or a question), a short assistant message is saved straight into the main
 * chat's thread. Saving it runs no model: the report is the thread's own last reply,
 * trimmed, so reporting back costs nothing. The main chat's agent reads it as part of
 * its history on its next turn.
 *
 * Runs started by the user inside a work thread update its status too, but are not
 * reported: the user is watching those.
 *
 * Live runs and their approval gates are in process memory, as every Session's are. After
 * a restart a thread that was working is marked `stopped` the next time it is opened.
 */

import type { AgentController, AgentControllerEvent, Session } from '@mastra/core/agent-controller';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraStorage } from '@mastra/core/storage';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  START_THREAD_TOOL,
  threadLink,
  WORK_THREAD_KEY,
  type WorkThreadInfo,
  type WorkThreadStatus,
  workThreadOf,
} from './work-thread-info';

/** The longest excerpt of a thread's last reply a report carries. */
export const REPORT_EXCERPT_CHARS = 600;

/** The text of a report saved into the main chat. Exported for tests. */
export function reportText(
  title: string,
  threadId: string,
  status: Exclude<WorkThreadStatus, 'working' | 'stopped'>,
  detail?: string,
): string {
  const link = threadLink(threadId, title);
  if (status === 'done') {
    return detail ? `${link} is done.\n\n${excerpt(detail)}` : `${link} is done.`;
  }
  if (status === 'needs_you') return `${link} needs you: ${detail ?? 'open it to continue.'}`;
  return `${link} stopped with an error${detail ? `: ${excerpt(detail)}` : '.'}`;
}

function excerpt(text: string): string {
  const t = text.trim();
  return t.length <= REPORT_EXCERPT_CHARS ? t : `${t.slice(0, REPORT_EXCERPT_CHARS).trimEnd()}…`;
}

/**
 * The run's request context for the thread: everything the starting run carried (the
 * host's values, the browser's time zone) except Mastra's own `mastra__*` keys, which
 * name the starting run's thread and resource.
 */
function carriedContext(from: RequestContext | undefined): RequestContext {
  const into = new RequestContext();
  if (!from) return into;
  for (const [key, value] of from.entries()) {
    if (!String(key).startsWith('mastra__')) into.set(key, value);
  }
  return into;
}

/** The text of an assistant message, or '' when it has none. */
function messageText(message: unknown): string {
  const m = message as { role?: string; content?: unknown } | undefined;
  if (m?.role !== 'assistant') return '';
  const content = m.content as { parts?: Array<{ type?: string; text?: string }> } | undefined;
  return (content?.parts ?? [])
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}

export type WorkThreadsConfig = {
  getController: () => Promise<AgentController>;
  /** The controller's own store: threads' metadata and the reports are written to it. */
  storage: MastraStorage;
  /**
   * Opens the Session a work thread runs on. The default opens one per thread, scope
   * `work:<threadId>`. A host that keeps its own session ids passes its own; it must
   * never return the user's own Session.
   */
  openSession?: (
    controller: AgentController,
    input: { resourceId: string; threadId: string },
  ) => Promise<Session>;
  /** Called on every status change, after it is saved (a host's own bookkeeping). */
  onStatus?: (threadId: string, status: WorkThreadStatus) => void;
  /**
   * Whether a `start_thread` call waits for the user's yes, from the starting run's request
   * context. A host whose own rules gate actions by what the run has read (a run that read
   * untrusted text approves every change) applies them here too, since the thread's runs
   * start from the brief alone. Gets the run's request context as the tool sees it (a
   * `RequestContext` or a plain record). Unset: the controller's own approval rules decide.
   */
  requireApproval?: (requestContext: unknown) => boolean;
  /**
   * Whether the run starting a thread had read untrusted content, by the host's own rule.
   * Kept as the thread's `untrusted`, for the host to apply its rules to the thread's runs.
   */
  startsUntrusted?: (requestContext: unknown) => boolean;
  /**
   * Screens a report's text before it is saved into the main chat, where the agent reads
   * it as its own words (a host withholding what reads like instructions, say).
   */
  screenReport?: (text: string, thread: WorkThreadInfo) => string;
  /**
   * Tears down the Session `openSession` opened, once its thread is idle with nothing
   * waiting. The default deletes the `work:<threadId>` session `openWorkSession` opens.
   */
  closeSession?: (
    controller: AgentController,
    input: { resourceId: string; threadId: string },
  ) => Promise<unknown>;
  /** How long an idle work thread keeps its Session before it is torn down. Default 60 s. */
  idleMs?: number;
};

type Tracked = {
  session: Session;
  /** Stops following the Session. */
  unsubscribe: () => void;
  /** Set while a run `start_thread` began is going: its outcome is reported. */
  background: boolean;
  /** The text of the run's latest finished assistant message. */
  lastReply: string;
  /** What the thread waits on, while it does. */
  waitingOn: string | undefined;
};

/** The default Session for a work thread: one per thread, scope `work:<threadId>`. */
export function openWorkSession(
  controller: AgentController,
  { resourceId, threadId }: { resourceId: string; threadId: string },
): Promise<Session> {
  return controller.createSession({
    resourceId,
    id: `${resourceId}::work:${threadId}`,
    scope: `work:${threadId}`,
    createInitialThread: false,
    threadId,
  });
}

/** Deletes the Session `openWorkSession` opened. */
export function closeWorkSession(
  controller: AgentController,
  { resourceId, threadId }: { resourceId: string; threadId: string },
): Promise<unknown> {
  return controller.deleteSession({ resourceId, scope: `work:${threadId}` });
}

export type WorkThreads = ReturnType<typeof createWorkThreads>;

export function createWorkThreads(config: WorkThreadsConfig) {
  /**
   * The work threads with a Session in this process. Set before any await when one is
   * opened, so two requests for the same thread share one Session and one subscription.
   */
  const live = new Map<string, Promise<Tracked>>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const idleMs = config.idleMs ?? 60_000;
  const closeSession = config.closeSession ?? closeWorkSession;
  const memory = async () => {
    const store = await config.storage.getStore('memory');
    if (!store) throw new Error('work threads need a memory store');
    return store;
  };

  const openSession = config.openSession ?? openWorkSession;

  async function setStatus(threadId: string, status: WorkThreadStatus) {
    const store = await memory();
    await store.updateThreadMetadata({
      id: threadId,
      update: (thread) => {
        const info = workThreadOf(thread);
        if (!info || info.status === status) return undefined;
        return { [WORK_THREAD_KEY]: { ...info, status } };
      },
    });
    config.onStatus?.(threadId, status);
  }

  /** Saves a report into the main chat's thread, as the agent's own message. */
  async function report(
    threadId: string,
    status: 'done' | 'needs_you' | 'failed',
    detail?: string,
  ) {
    const store = await memory();
    const thread = await store.getThreadById({ threadId });
    const info = workThreadOf(thread);
    if (!thread || !info) return;
    const said = detail && config.screenReport ? config.screenReport(detail, info) : detail;
    const text = reportText(info.title || 'A thread', threadId, status, said);
    await store.saveMessages({
      messages: [
        {
          id: globalThis.crypto.randomUUID(),
          role: 'assistant',
          threadId: info.parentThreadId,
          resourceId: thread.resourceId,
          createdAt: new Date(),
          content: {
            format: 2,
            parts: [{ type: 'text', text }],
            content: text,
            metadata: { [WORK_THREAD_KEY]: { threadId, status } },
          },
        },
      ],
    });
  }

  /**
   * Tears a work thread's Session down once it has sat idle, with nothing waiting, for
   * `idleMs`. Opening the thread again makes a new one.
   */
  function releaseWhenIdle(threadId: string, resourceId: string, tracked: Tracked) {
    clearTimeout(idleTimers.get(threadId));
    const timer = setTimeout(async () => {
      idleTimers.delete(threadId);
      const state = tracked.session.displayState.get();
      if (state.isRunning || state.pendingApprovals.size > 0 || state.pendingSuspensions.size > 0)
        return;
      const current = await live.get(threadId);
      if (current !== tracked) return;
      live.delete(threadId);
      tracked.unsubscribe();
      await closeSession(await config.getController(), { resourceId, threadId }).catch(
        () => undefined,
      );
    }, idleMs);
    // Never keeps the process alive (Node); a plain number elsewhere.
    (timer as { unref?: () => void }).unref?.();
    idleTimers.set(threadId, timer);
  }

  /** Follows one work thread's Session until it is released. */
  function track(threadId: string, resourceId: string, session: Session): Tracked {
    const tracked: Tracked = {
      session,
      unsubscribe: () => undefined,
      background: false,
      lastReply: '',
      waitingOn: undefined,
    };
    // Reports and saves happen in order, one after another.
    let chain: Promise<void> = Promise.resolve();
    const later = (step: () => Promise<void>) => {
      chain = chain.then(step).catch(() => {
        // A failed status save or report must not stop the next one.
      });
    };
    tracked.unsubscribe = session.subscribe((event: AgentControllerEvent) => {
      switch (event.type) {
        case 'agent_start':
          clearTimeout(idleTimers.get(threadId));
          tracked.lastReply = '';
          tracked.waitingOn = undefined;
          later(() => setStatus(threadId, 'working'));
          break;
        case 'message_end': {
          // The display state still holds the finished message here.
          const text = messageText(session.displayState.get().currentMessage);
          if (text) tracked.lastReply = text;
          break;
        }
        case 'tool_end':
          // A call it waited on was decided and ran: it is working again.
          if (tracked.waitingOn) {
            tracked.waitingOn = undefined;
            later(() => setStatus(threadId, 'working'));
          }
          break;
        case 'tool_approval_required':
          tracked.waitingOn = `it is waiting for your OK to run ${event.toolName}.`;
          later(async () => {
            await setStatus(threadId, 'needs_you');
            if (tracked.background) await report(threadId, 'needs_you', tracked.waitingOn);
          });
          break;
        case 'tool_suspended': {
          const question = (event.suspendPayload as { question?: unknown } | undefined)?.question;
          tracked.waitingOn =
            typeof question === 'string' && question
              ? `it asked "${excerpt(question)}"`
              : 'it is waiting for your answer.';
          break;
        }
        case 'agent_end': {
          const reason = event.reason;
          if (reason === 'suspended') {
            // A question ends the run; the answer resumes it from the thread itself.
            const waitingOn = tracked.waitingOn;
            const background = tracked.background;
            tracked.background = false;
            later(async () => {
              await setStatus(threadId, 'needs_you');
              if (background) await report(threadId, 'needs_you', waitingOn);
            });
          } else if (reason === 'error') {
            const background = tracked.background;
            tracked.background = false;
            later(async () => {
              await setStatus(threadId, 'failed');
              if (background) await report(threadId, 'failed');
            });
          } else {
            const background = tracked.background;
            const reply = tracked.lastReply;
            tracked.background = false;
            later(async () => {
              await setStatus(threadId, reason === 'aborted' ? 'stopped' : 'done');
              if (background && reason !== 'aborted') await report(threadId, 'done', reply);
            });
          }
          if (reason !== 'suspended') releaseWhenIdle(threadId, resourceId, tracked);
          break;
        }
        default:
          break;
      }
    });
    return tracked;
  }

  /**
   * Starts a work thread: makes it, then runs the agent on the brief in the background.
   * Resolves once the thread exists, not when the run ends.
   */
  async function start({
    resourceId,
    parentThreadId,
    title,
    brief,
    requestContext,
  }: {
    resourceId: string;
    parentThreadId: string;
    title: string;
    brief: string;
    requestContext?: RequestContext;
  }): Promise<{ threadId: string; title: string; status: WorkThreadStatus }> {
    const controller = await config.getController();
    const threadId = globalThis.crypto.randomUUID();
    const untrusted = config.startsUntrusted?.(requestContext) ?? false;
    const info: WorkThreadInfo = {
      parentThreadId,
      title,
      status: 'working',
      ...(untrusted ? { untrusted } : {}),
    };
    const store = await memory();
    const now = new Date();
    // Saved straight to the store, then opened: making it with `session.thread.create` on
    // the new Session aborted the run in progress on the user's Session (core 1.75), which
    // is the very run calling start_thread.
    await store.saveThread({
      thread: {
        id: threadId,
        resourceId,
        title,
        createdAt: now,
        updatedAt: now,
        metadata: { [WORK_THREAD_KEY]: info },
      },
    });
    const opening = openSession(controller, { resourceId, threadId }).then((session) =>
      track(threadId, resourceId, session),
    );
    live.set(threadId, opening);
    opening.catch(() => live.delete(threadId));
    const tracked = await opening;
    const { session } = tracked;
    tracked.background = true;
    // Not awaited: the main chat carries on while the thread works.
    void session
      .sendMessage({ content: brief, requestContext: carriedContext(requestContext) })
      .catch(async (err: unknown) => {
        if (!tracked.background) return;
        tracked.background = false;
        await setStatus(threadId, 'failed').catch(() => undefined);
        await report(threadId, 'failed', err instanceof Error ? err.message : String(err)).catch(
          () => undefined,
        );
      });
    return { threadId, title, status: 'working' };
  }

  /**
   * The Session a work thread of this resource runs on, or undefined when the thread is
   * not a work thread of that resource. Opens one when the thread has none live (after a
   * restart), and marks a thread left `working` by a dead run as `stopped`.
   */
  async function sessionForThread(threadId: string, resourceId: string) {
    const store = await memory();
    const thread = await store.getThreadById({ threadId });
    const info = workThreadOf(thread);
    if (!thread || !info || thread.resourceId !== resourceId) return undefined;
    let opening = live.get(threadId);
    if (!opening) {
      const fresh = (async () => {
        const controller = await config.getController();
        const tracked = track(
          threadId,
          resourceId,
          await openSession(controller, { resourceId, threadId }),
        );
        // Nothing runs on a Session just opened: a thread left working or waiting by a
        // run in an earlier process is stopped (its approval gates went with that process).
        if (info.status === 'working' || info.status === 'needs_you') {
          await setStatus(threadId, 'stopped');
        }
        releaseWhenIdle(threadId, resourceId, tracked);
        return tracked;
      })();
      live.set(threadId, fresh);
      fresh.catch(() => live.delete(threadId));
      opening = fresh;
    }
    return (await opening).session;
  }

  /**
   * Marks every work thread left working or waiting as stopped. Call once when the store's
   * controller starts: nothing runs yet, and approval gates live only in the process that
   * opened them. Threads the process has already opened are left alone.
   */
  async function recover(): Promise<void> {
    const store = await memory();
    const { threads } = await store.listThreads({ perPage: false });
    for (const thread of threads) {
      const info = workThreadOf(thread);
      if (!info || live.has(thread.id)) continue;
      if (info.status === 'working' || info.status === 'needs_you') {
        await setStatus(thread.id, 'stopped');
      }
    }
  }

  /** Whether a work thread's run is going, or waits on a person, in this process. */
  async function busy(threadId: string): Promise<boolean> {
    const tracked = await live.get(threadId)?.catch(() => undefined);
    if (!tracked) return false;
    const state = tracked.session.displayState.get();
    return state.isRunning || state.pendingApprovals.size > 0 || state.pendingSuspensions.size > 0;
  }

  /** Stops following a work thread that is being deleted, and closes its Session. */
  async function forget(threadId: string, resourceId: string): Promise<void> {
    clearTimeout(idleTimers.get(threadId));
    idleTimers.delete(threadId);
    const tracked = await live.get(threadId)?.catch(() => undefined);
    live.delete(threadId);
    if (!tracked) return;
    tracked.background = false;
    tracked.unsubscribe();
    await closeSession(await config.getController(), { resourceId, threadId }).catch(
      () => undefined,
    );
  }

  /** A work thread's state, or undefined for any other thread. */
  async function threadInfo(threadId: string): Promise<WorkThreadInfo | undefined> {
    const store = await memory();
    return workThreadOf(await store.getThreadById({ threadId }));
  }

  const tool = createTool({
    id: START_THREAD_TOOL,
    description:
      "Start a separate thread for one piece of work, so it runs on its own while this chat stays free for the user. Hand off every task that takes more than a couple of tool calls: a change to many records, a cleanup, research across several sources, anything the user will want to follow up on. Answer a quick question, or make one small change, yourself. Give the thread a short title and a brief with everything it needs, in the user's words where possible: the thread does not see this chat. Then tell the user in a sentence what the thread will do, and do not do the work here as well. The thread reports back here when it finishes or needs the user. Only the main chat starts threads: inside a thread, do the work yourself.",
    inputSchema: z.object({
      title: z.string().min(1).max(80).describe('A few words naming the work.'),
      brief: z
        .string()
        .min(1)
        .max(8000)
        .describe("The whole task, in the user's words where possible."),
    }),
    ...(config.requireApproval
      ? {
          requireApproval: (_input: unknown, ctx?: { requestContext?: unknown }) =>
            config.requireApproval?.(ctx?.requestContext) ?? false,
        }
      : {}),
    execute: async ({ title, brief }, ctx) => {
      const parentThreadId = ctx?.agent?.threadId;
      const resourceId = ctx?.agent?.resourceId;
      if (!parentThreadId || !resourceId) {
        throw new Error('Threads can only be started from a conversation.');
      }
      // A thread never starts threads of its own: reports go to the main chat only.
      const store = await memory();
      if (workThreadOf(await store.getThreadById({ threadId: parentThreadId }))) {
        throw new Error('Threads can only be started from the main chat.');
      }
      return start({
        resourceId,
        parentThreadId,
        title: title.trim(),
        brief,
        ...(ctx?.requestContext ? { requestContext: ctx.requestContext } : {}),
      });
    },
  });

  return {
    /** The `start_thread` tool, for the controller's `tools`. */
    tool,
    start,
    sessionForThread,
    threadInfo,
    recover,
    busy,
    forget,
  };
}
