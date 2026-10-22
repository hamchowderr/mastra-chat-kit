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
  WORK_THREAD_KEY,
  type WorkThreadInfo,
  type WorkThreadStatus,
  workThreadOf,
} from './work-thread-info';
import { createSteeringTools } from './work-thread-steering';
import { excerpt, line, messageText, reportText, tasksOf, waitingLine } from './work-thread-text';

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

/**
 * A specialist a work thread can run as: one of the controller's modes, which carries its own
 * instructions and tools. The main chat's agent picks one per thread from their descriptions.
 */
export type ThreadAgent = {
  id: string;
  name: string;
  /** What it does and when to pick it, for the main chat's agent. */
  description: string;
  /** The controller mode its threads run in. */
  modeId: string;
};

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
   * Fields added to the result of a `suggest_threads` call refused because its run read
   * untrusted content. Its briefs stay in the chat's history, so a host marks the result to
   * hold later runs that read it to its rules (asking before a thread starts, say).
   */
  refusedSuggestion?: Record<string, unknown>;
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
  /**
   * The specialists threads can run as. With them, `start_thread` takes an `agent` (the first
   * one when left out) and the thread runs in that agent's mode, whatever mode the main chat
   * is in. Without them, a thread runs in the controller's default mode.
   */
  agents?: readonly ThreadAgent[];
  /**
   * How many of one resource's threads may work at once. A thread started past it is
   * `queued` and starts, in the order they came, as working ones finish or stop for the
   * user. Unset: no limit. Queued threads are kept in process memory; after a restart they
   * are marked stopped, like threads that were working.
   */
  maxWorking?: number;
  /**
   * Adds the host's values to the request context of each run the kit starts in a work
   * thread (its brief, a message from the main chat), from the thread's state: a host that
   * taints every run in an `untrusted` thread sets that here, as it does for runs the person
   * starts in the thread.
   */
  runContext?: (requestContext: RequestContext, thread: WorkThreadInfo) => void;
  /**
   * Whether a report may carry the run's own words (its last reply, its question, its error),
   * from the thread's state and the reported run's messages (as the Session showed them, tool
   * results as the host's processors left them). A host whose rules follow what a run has
   * read says no for a run that read untrusted content: the report then says only how the
   * run ended, and the main chat reads the thread with `read_thread`, under the host's rules
   * for what that returns. Unset: reports carry the words.
   */
  reportsWords?: (input: {
    threadId: string;
    thread: WorkThreadInfo;
    runMessages: unknown[];
  }) => boolean;
};

type Tracked = {
  session: Session;
  /** Stops following the Session. */
  unsubscribe: () => void;
  /** Set while a run `start_thread` or `message_thread` began is going: its outcome is reported. */
  background: boolean;
  /**
   * The request contexts of the runs the kit queued on the Session that have not started
   * yet, in order; each run is reported.
   */
  pending: RequestContext[];
  /** The messages of the run in progress (or last ended), as the Session showed them. */
  runMessages: unknown[];
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

  /** A run's request context in a work thread: the caller's, plus the host's for the thread. */
  function contextFor(from: RequestContext | undefined, info: WorkThreadInfo): RequestContext {
    const context = carriedContext(from);
    config.runContext?.(context, info);
    return context;
  }

  /** Threads waiting for a slot: their state, brief and the starting run's request context. */
  const queued = new Map<
    string,
    { info: WorkThreadInfo; brief: string; requestContext: RequestContext | undefined }
  >();
  /** One start or queue decision per resource at a time, so two never take the last slot. */
  const turns = new Map<string, Promise<unknown>>();
  function inTurn<T>(resourceId: string, step: () => Promise<T>): Promise<T> {
    const run = (turns.get(resourceId) ?? Promise.resolve()).then(step, step);
    const settled = run.catch(() => undefined);
    turns.set(resourceId, settled);
    void settled.then(() => {
      if (turns.get(resourceId) === settled) turns.delete(resourceId);
    });
    return run;
  }

  /** A resource's work threads, oldest first. */
  async function threadsOf(resourceId: string) {
    const store = await memory();
    const { threads } = await store.listThreads({ perPage: false, filter: { resourceId } });
    return threads
      .flatMap((thread) => {
        const info = workThreadOf(thread);
        return info ? [{ thread, info }] : [];
      })
      .sort((a, b) => +new Date(a.thread.createdAt) - +new Date(b.thread.createdAt));
  }

  /** Whether a resource has a free slot for one more working thread. */
  async function hasSlot(resourceId: string): Promise<boolean> {
    if (!config.maxWorking) return true;
    const working = (await threadsOf(resourceId)).filter((t) => t.info.status === 'working');
    return working.length < config.maxWorking;
  }

  /**
   * Puts a work thread's Session in its agent's mode: the agent it was started as, or the first
   * one offered for a thread from before it had one (or whose agent is gone).
   */
  async function holdMode(session: Session, info: WorkThreadInfo) {
    const offered = config.agents ?? [];
    const agent = offered.find((a) => a.id === info.agent?.id) ?? offered[0];
    if (agent && session.mode.get() !== agent.modeId) {
      await session.mode.switch({ modeId: agent.modeId });
    }
  }

  /**
   * Saves a change to a work thread's state: its status, and what goes with it (its checklist,
   * its latest line, whether it is resolved). A key set to undefined is removed.
   */
  async function save(
    threadId: string,
    change: { [K in keyof WorkThreadInfo]?: WorkThreadInfo[K] | undefined },
  ) {
    const store = await memory();
    let changed: WorkThreadStatus | undefined;
    await store.updateThreadMetadata({
      id: threadId,
      update: (thread) => {
        const info = workThreadOf(thread);
        if (!info) return undefined;
        // Merged into what is stored, not the parsed copy, so a host's own keys survive.
        const raw = (thread.metadata as Record<string, unknown>)[WORK_THREAD_KEY] as Record<
          string,
          unknown
        >;
        const next: Record<string, unknown> = { ...raw, ...change };
        // A thread that works or waits is never filed under Resolved.
        if (change.status === 'working' || change.status === 'needs_you') delete next.resolved;
        for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
        if (JSON.stringify(next) === JSON.stringify(raw)) return undefined;
        if (change.status && change.status !== info.status) changed = change.status;
        return { [WORK_THREAD_KEY]: next };
      },
    });
    if (changed) config.onStatus?.(threadId, changed);
  }

  function setStatus(threadId: string, status: WorkThreadStatus, latest?: string) {
    return save(threadId, latest === undefined ? { status } : { status, latest });
  }

  /** Saves a report into the main chat's thread, as the agent's own message. */
  async function report(
    threadId: string,
    status: 'done' | 'needs_you' | 'failed',
    detail?: string,
    /** The reported run's messages, as the Session showed them. */
    runMessages: unknown[] = [],
  ) {
    const store = await memory();
    const thread = await store.getThreadById({ threadId });
    const info = workThreadOf(thread);
    if (!thread || !info) return;
    const words = config.reportsWords?.({ threadId, thread: info, runMessages }) ?? true;
    const kept = words ? detail : undefined;
    const said = kept && config.screenReport ? config.screenReport(kept, info) : kept;
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
      pending: [],
      runMessages: [],
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
        case 'agent_start': {
          clearTimeout(idleTimers.get(threadId));
          tracked.lastReply = '';
          tracked.waitingOn = undefined;
          // A run the kit queued (a brief, a message from the main chat) is reported.
          tracked.runMessages = [];
          if (tracked.pending.shift()) tracked.background = true;
          // The person started a queued thread from the thread itself: its brief runs next,
          // and it no longer waits for a slot.
          const waiting = queued.get(threadId);
          if (waiting) {
            queued.delete(threadId);
            send(
              threadId,
              resourceId,
              tracked,
              waiting.brief,
              contextFor(waiting.requestContext, waiting.info),
            );
          }
          // A new run takes the thread out of Resolved, and what it waited on is past.
          later(() => save(threadId, { status: 'working', latest: undefined }));
          break;
        }
        case 'task_updated': {
          const tasks = tasksOf(event.tasks);
          const doing = (event.tasks as Array<{ status?: string; activeForm?: string }>).find(
            (t) => t.status === 'in_progress',
          );
          later(() =>
            save(threadId, {
              tasks: tasks.length ? tasks : undefined,
              ...(doing?.activeForm ? { latest: line(doing.activeForm) } : {}),
            }),
          );
          break;
        }
        case 'message_end': {
          // The display state still holds the finished message here.
          const finished = session.displayState.get().currentMessage;
          if (finished) tracked.runMessages.push(finished);
          const text = messageText(finished);
          if (text) tracked.lastReply = text;
          break;
        }
        case 'tool_end':
          // A call it waited on was decided and ran: it is working again.
          if (tracked.waitingOn) {
            tracked.waitingOn = undefined;
            later(() => save(threadId, { status: 'working', latest: undefined }));
          }
          break;
        case 'tool_approval_required':
          tracked.waitingOn = `it is waiting for your OK to run ${event.toolName}.`;
          later(async () => {
            await setStatus(threadId, 'needs_you', `Waiting for your OK to run ${event.toolName}`);
            if (tracked.background) {
              await report(threadId, 'needs_you', tracked.waitingOn, [...tracked.runMessages]);
            }
            await drain(resourceId);
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
            const { background } = tracked;
            const seen = [...tracked.runMessages];
            tracked.background = false;
            later(async () => {
              await setStatus(threadId, 'needs_you', waitingLine(waitingOn));
              if (background) await report(threadId, 'needs_you', waitingOn, seen);
              await drain(resourceId);
            });
          } else if (reason === 'error') {
            const { background } = tracked;
            const seen = [...tracked.runMessages];
            tracked.background = false;
            later(async () => {
              await setStatus(threadId, 'failed', 'Stopped with an error');
              if (background) await report(threadId, 'failed', undefined, seen);
              await drain(resourceId);
            });
          } else {
            const { background } = tracked;
            const seen = [...tracked.runMessages];
            const reply = tracked.lastReply;
            tracked.background = false;
            // A Stop stops what the kit queued behind the run too.
            if (reason === 'aborted') tracked.pending = [];
            later(async () => {
              if (reason === 'aborted') await setStatus(threadId, 'stopped', 'Stopped');
              else await setStatus(threadId, 'done', reply ? line(reply) : 'Done');
              if (background && reason !== 'aborted') await report(threadId, 'done', reply, seen);
              await drain(resourceId);
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
   * Queues a run on a work thread's Session (it starts now when the Session is idle, else
   * after the run in progress), to be reported back to the main chat. Not awaited: the main
   * chat carries on while the thread works.
   */
  function send(
    threadId: string,
    resourceId: string,
    tracked: Tracked,
    content: string,
    requestContext: RequestContext,
  ) {
    tracked.pending.push(requestContext);
    void tracked.session.queueMessage({ content, requestContext }).catch(async (err: unknown) => {
      // A run that started and failed was reported at its end; only one that never started
      // is reported here.
      const waiting = tracked.pending.indexOf(requestContext);
      if (waiting < 0) return;
      tracked.pending.splice(waiting, 1);
      await failed(threadId, resourceId, err);
    });
  }

  /** Marks a thread failed, reports it to the main chat and frees its slot. */
  async function failed(threadId: string, resourceId: string, err: unknown) {
    await setStatus(threadId, 'failed', 'Stopped with an error').catch(() => undefined);
    const why = err instanceof Error ? err.message : String(err);
    await report(threadId, 'failed', why).catch(() => undefined);
    // Not awaited: this can run inside a start or queue decision.
    void drain(resourceId).catch(() => undefined);
  }

  /**
   * Opens a work thread's Session and runs its agent on the brief, in the background. A
   * thread whose Session could not be opened is marked failed, so it holds no slot. Resolves
   * to whether the run was queued.
   */
  async function run(
    threadId: string,
    resourceId: string,
    info: WorkThreadInfo,
    brief: string,
    requestContext: RequestContext | undefined,
  ) {
    try {
      // A queued thread the person opened meanwhile already has one.
      let opening = live.get(threadId);
      if (!opening) {
        const controller = await config.getController();
        const fresh = openSession(controller, { resourceId, threadId }).then((session) =>
          track(threadId, resourceId, session),
        );
        live.set(threadId, fresh);
        fresh.catch(() => live.delete(threadId));
        opening = fresh;
      }
      const tracked = await opening;
      clearTimeout(idleTimers.get(threadId));
      await holdMode(tracked.session, info);
      send(threadId, resourceId, tracked, brief, contextFor(requestContext, info));
      return true;
    } catch (err) {
      await failed(threadId, resourceId, err);
      return false;
    }
  }

  /**
   * Starts a resource's queued threads, oldest first, while it has free slots. A queued
   * thread no longer in the store (deleted) is dropped.
   */
  function drain(resourceId: string): Promise<void> {
    if (!config.maxWorking) return Promise.resolve();
    return inTurn(resourceId, async () => {
      for (const { thread } of await threadsOf(resourceId)) {
        if (!queued.has(thread.id)) continue;
        if (!(await hasSlot(resourceId))) return;
        // Taken now, with no await before: the person may have started it meanwhile.
        const waiting = queued.get(thread.id);
        if (!waiting) continue;
        queued.delete(thread.id);
        await save(thread.id, { status: 'working', latest: undefined });
        await run(thread.id, resourceId, waiting.info, waiting.brief, waiting.requestContext);
      }
    });
  }

  /**
   * Starts a work thread: makes it, then runs the agent on the brief in the background, or
   * queues it when the resource has `maxWorking` threads working already. Resolves once the
   * thread exists, not when the run ends.
   */
  async function start({
    resourceId,
    parentThreadId,
    title,
    brief,
    agent,
    requestContext,
  }: {
    resourceId: string;
    parentThreadId: string;
    title: string;
    brief: string;
    /** The specialist to run; the first of `agents` when left out. */
    agent?: ThreadAgent;
    requestContext?: RequestContext;
  }): Promise<{ threadId: string; title: string; status: WorkThreadStatus; agent?: string }> {
    const threadId = globalThis.crypto.randomUUID();
    const untrusted = config.startsUntrusted?.(requestContext) ?? false;
    const runs = agent ?? config.agents?.[0];
    return inTurn(resourceId, async () => {
      const status: WorkThreadStatus = (await hasSlot(resourceId)) ? 'working' : 'queued';
      const info: WorkThreadInfo = {
        parentThreadId,
        title,
        status,
        ...(status === 'queued' ? { latest: 'Waiting for another thread to finish' } : {}),
        ...(untrusted ? { untrusted } : {}),
        ...(runs ? { agent: { id: runs.id, name: runs.name } } : {}),
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
          // The Session restores the thread's mode from `currentModeId` when it opens it.
          metadata: { [WORK_THREAD_KEY]: info, ...(runs ? { currentModeId: runs.modeId } : {}) },
        },
      });
      let result: WorkThreadStatus = status;
      if (status === 'queued') queued.set(threadId, { info, brief, requestContext });
      else if (!(await run(threadId, resourceId, info, brief, requestContext))) result = 'failed';
      return { threadId, title, status: result, ...(runs ? { agent: runs.name } : {}) };
    });
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
        const session = await openSession(controller, { resourceId, threadId });
        await holdMode(session, info);
        const tracked = track(threadId, resourceId, session);
        // Nothing runs on a Session just opened: a thread left working or waiting by a
        // run in an earlier process is stopped (its approval gates went with that process).
        if (info.status === 'working' || info.status === 'needs_you') {
          await setStatus(threadId, 'stopped', 'Stopped when the server restarted');
          void drain(resourceId).catch(() => undefined);
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
        await setStatus(thread.id, 'stopped', 'Stopped when the server restarted');
      } else if (info.status === 'queued' && !queued.has(thread.id)) {
        await setStatus(thread.id, 'stopped', 'Stopped when the server restarted, before it began');
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
    queued.delete(threadId);
    const tracked = await live.get(threadId)?.catch(() => undefined);
    live.delete(threadId);
    if (tracked) {
      tracked.background = false;
      tracked.pending = [];
      tracked.unsubscribe();
      await closeSession(await config.getController(), { resourceId, threadId }).catch(
        () => undefined,
      );
    }
    // Its slot is free.
    void drain(resourceId).catch(() => undefined);
  }

  /**
   * Sends a work thread a message from the main chat, as `message_thread` does: an idle
   * thread runs on it now, a running one once the run in progress ends (the Session's
   * queue), each a run of its own with the caller's request context. That run is reported
   * back like the first one. The caller checks the thread is one of its own.
   */
  async function message({
    threadId,
    resourceId,
    text,
    requestContext,
  }: {
    threadId: string;
    resourceId: string;
    text: string;
    requestContext?: RequestContext;
  }): Promise<{ running: boolean }> {
    const session = await sessionForThread(threadId, resourceId);
    const tracked = await live.get(threadId);
    if (!session || !tracked) throw new Error('That thread could not be opened.');
    if (config.startsUntrusted?.(requestContext)) await save(threadId, { untrusted: true });
    const info = await threadInfo(threadId);
    if (!info) throw new Error('That thread could not be opened.');
    // A run is going, or one the kit queued has yet to start: this one waits for it.
    const running = session.displayState.get().isRunning || tracked.pending.length > 0;
    send(threadId, resourceId, tracked, text, contextFor(requestContext, info));
    return { running };
  }

  /** A work thread's state, or undefined for any other thread. */
  async function threadInfo(threadId: string): Promise<WorkThreadInfo | undefined> {
    const store = await memory();
    return workThreadOf(await store.getThreadById({ threadId }));
  }

  const agents = config.agents ?? [];
  const agentIds = agents.map((a) => a.id) as [string, ...string[]];
  const agentField =
    agents.length > 0
      ? {
          agent: z
            .enum(agentIds)
            .optional()
            .describe(
              `Who does the work. ${agents.map((a) => `${a.id}: ${a.description}`).join(' ')} Default ${agents[0]?.id}.`,
            ),
        }
      : {};

  const tool = createTool({
    id: START_THREAD_TOOL,
    description:
      "Start a separate thread for one piece of work, so it runs on its own while this chat stays free for the user. Hand off every task that takes more than a couple of tool calls: a change to many records, a cleanup, research across several sources, anything the user will want to follow up on. Answer a quick question, or make one small change, yourself. Give the thread a short title and a brief with everything it needs, in the user's words where possible: the thread does not see this chat. Then tell the user in a sentence what the thread will do, and do not do the work here as well. The thread reports back here when it finishes or needs the user. To check on a thread or change its plan later, use list_threads, read_thread and message_thread rather than starting another. Only the main chat starts threads: inside a thread, do the work yourself.",
    inputSchema: z.object({
      title: z.string().min(1).max(80).describe('A few words naming the work.'),
      brief: z
        .string()
        .min(1)
        .max(8000)
        .describe("The whole task, in the user's words where possible."),
      ...agentField,
    }),
    ...(config.requireApproval
      ? {
          requireApproval: (_input: unknown, ctx?: { requestContext?: unknown }) =>
            config.requireApproval?.(ctx?.requestContext) ?? false,
        }
      : {}),
    execute: async (input, ctx) => {
      const { title, brief } = input;
      const chosen = agents.find((a) => a.id === (input as { agent?: string }).agent);
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
        ...(chosen ? { agent: chosen } : {}),
        ...(ctx?.requestContext ? { requestContext: ctx.requestContext } : {}),
      });
    },
  });

  /** The main chat's `list_threads`, `read_thread` and `message_thread` tools. */
  const steering = createSteeringTools({
    storage: config.storage,
    message,
    requireApproval: config.requireApproval,
    screen: config.screenReport,
    untrusted: config.startsUntrusted,
    refusal: config.refusedSuggestion,
    agents: config.agents,
  });

  return {
    /** The `start_thread` tool, for the controller's `tools`. */
    tool,
    /** The tools that steer started threads, for the controller's `tools` beside `tool`. */
    steering,
    start,
    sessionForThread,
    message,
    /** Starts queued threads into free slots (it runs on its own as threads finish). */
    drain,
    threadInfo,
    recover,
    busy,
    forget,
  };
}
