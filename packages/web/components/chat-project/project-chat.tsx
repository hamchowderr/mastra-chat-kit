'use client';

import { PanelRightIcon } from 'lucide-react';
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { ApprovalViews } from '@/components/chat/approval-view';
import { Composer, type ComposerSubmit, type ModelOption } from '@/components/chat/composer';
import type { ToolViews } from '@/components/chat/tool-steps';
import { UsageContext } from '@/components/chat/turn-extras';
import {
  type UseAgentControllerChat,
  useAgentControllerChat,
} from '@/lib/agent-controller/use-agent-controller-chat';
import { type ThreadItem, useThreads } from '@/lib/agent-controller/use-threads';
import { cn } from '@/lib/utils';
import { ChatView } from './chat-view';
import { ProjectPanel, type ProjectTab, THREADS_TAB } from './project-panel';
import { ThreadChecklist } from './thread-checklist';
import type { ThreadOutput } from './thread-groups';
import { threadIdFromHref } from './thread-row';

/** How wide the chat area must be for the panel to sit beside the chat, not over it. */
const SIDE_BY_SIDE_PX = 900;

/** How often thread statuses are re-read while one is working. */
const POLL_MS = 3000;

/** An ordinary conversation, as opposed to a work thread. */
const isConversation = (t: ThreadItem) => !t.parentThreadId;

/** What the composer sends with a turn: its words, files, and the picks the host offers. */
const turnOptions = ({ model, webSearch, files }: ComposerSubmit, mode?: string) => ({
  ...(model ? { model } : {}),
  ...(webSearch ? { webSearch } : {}),
  ...(mode ? { mode } : {}),
  ...(files?.length
    ? {
        files: files.map((f) => ({
          url: f.url,
          mediaType: f.mediaType,
          ...(f.filename ? { filename: f.filename } : {}),
        })),
      }
    : {}),
});

/**
 * A chat shaped like a Claude project: one chat, and the threads it starts for pieces of work,
 * in a panel beside it.
 *
 * The chat is the project's one conversation (the newest, if older ones exist; the first
 * message makes it). The panel on the right holds tabs: Threads, every thread grouped by what
 * it needs (waiting on you, working, idle, resolved), then the host's own (`tabs`: a Library, its
 * pull requests...). The panel can be hidden, and covers the chat where the screen is narrow.
 *
 * The agent starts a thread with its `start_thread` tool (server: lib/work-threads.ts). The
 * thread shows up as a row under the message that started it, with its status. Opening it,
 * from that row or the list, shows its own conversation in the panel, under "Threads › title",
 * where you can answer its approvals and questions and steer it. When a thread finishes or
 * stops for you, a short note with a link to it lands in the chat (saved by the server, no
 * model call).
 *
 * Both boxes are the kit's one composer: attachments, a screenshot, dictation, the token usage,
 * and the model picker and web search where the host turns them on. Two engines run side by
 * side, so the chat keeps streaming while a thread is open. Every tool call shows as a step
 * row, folded into one line per run, unless the host's `toolViews` draws it some other way.
 *
 *   <ProjectChat />
 */
export function ProjectChat({
  className,
  approvalViews,
  toolViews,
  modes,
  isChat = isConversation,
  outputsOf,
  tabs = [],
  models = false,
  webSearch = false,
  placeholder = 'Ask anything…',
  emptyText = 'Ask for anything. Bigger pieces of work get a thread of their own.',
}: {
  className?: string;
  /** What approval cards say, per tool name (components/chat/approval-view.tsx). */
  approvalViews?: ApprovalViews | undefined;
  /** How the host's own tools show in both views (chat/tool-steps.tsx). */
  toolViews?: ToolViews | undefined;
  /**
   * Controller modes the person can pick in the chat, first one selected. Fewer than two shows
   * no picker.
   */
  modes?: ReadonlyArray<{ id: string; name: string }> | undefined;
  /**
   * Which conversations can be the project's chat. Defaults to every one that is not a work
   * thread; a host with conversations of its own (a site's, say) leaves those out.
   */
  isChat?: ((t: ThreadItem) => boolean) | undefined;
  /**
   * What each thread made that opens on its own page (a site it built, say): an icon on its
   * row and a link in its header.
   */
  outputsOf?: ((t: ThreadItem) => ThreadOutput[]) | undefined;
  /** The host's tabs in the panel, after Threads (a Library, pull requests, schedules). */
  tabs?: readonly ProjectTab[] | undefined;
  /**
   * The composer's model picker (chat/composer.tsx). Off by default: each turn runs on the
   * server's own model unless the server allows the ones offered.
   */
  models?: ModelOption[] | false;
  /** The composer's "Search the web" toggle, for an agent that can search. */
  webSearch?: boolean;
  placeholder?: string;
  emptyText?: string;
}) {
  const main = useAgentControllerChat();
  const thread = useAgentControllerChat();
  const { threads, refresh, resolve } = useThreads({ refreshSignal: main.refreshSignal });
  const [openId, setOpenId] = useState<string | null>(null);
  const [threadRunning, setThreadRunning] = useState(false);
  const [tab, setTab] = useState(THREADS_TAB);
  const mainId = useMainThread(main, isChat);
  const [mode, setMode] = useState(modes?.[0]?.id);

  const work = new Map(threads.filter((t) => t.parentThreadId).map((t) => [t.id, t]));
  const opened = openId ? work.get(openId) : undefined;
  const mainBusy = main.status === 'streaming';
  const chats = threads.filter((t) => isChat(t) && !t.archived);
  // The project's threads: every one a chat started (a site's conversation starts none here).
  const projectThreads = [...work.values()].filter((t) =>
    chats.some((c) => c.id === t.parentThreadId),
  );

  // The panel shows where there is room, and opens over the chat on a narrow screen.
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const [roomy, setRoomy] = useState(true);
  const [panelShown, setPanelShown] = useState<boolean | null>(null);
  useEffect(() => {
    if (!area || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(([entry]) => {
      if (entry) setRoomy(entry.contentRect.width >= SIDE_BY_SIDE_PX);
    });
    watch.observe(area);
    return () => watch.disconnect();
  }, [area]);
  // Until the person shows or hides it, the panel follows the room there is.
  const panelOpen = Boolean(openId) || (panelShown ?? roomy);
  const covered = panelOpen && !roomy;

  const { openThread: openInThread } = thread;
  const { openThread: openInMain } = main;
  // Only the latest open (or going back) counts: a slow one never lands over a newer one.
  const openSeq = useRef(0);
  const open = useCallback(
    async (id: string) => {
      const seq = ++openSeq.current;
      setOpenId(id);
      const { running, stale } = await openInThread(id);
      if (!stale && seq === openSeq.current) setThreadRunning(running);
    },
    [openInThread],
  );
  const back = () => {
    openSeq.current++;
    setOpenId(null);
    setThreadRunning(false);
  };

  // Focus moves into a thread when it opens, and back to what opened it when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const panelClose = useRef<HTMLButtonElement>(null);
  const openPanel = (id: string) => {
    if (!openId) opener.current = document.activeElement as HTMLElement | null;
    void open(id);
  };
  useEffect(() => {
    if (openId) panelClose.current?.focus();
  }, [openId]);
  const closeThread = () => {
    back();
    void refresh();
    const to = opener.current;
    opener.current = null;
    // After the thread is gone; the opener may have gone too (a row in a list that changed).
    requestAnimationFrame(() => {
      if (to?.isConnected) to.focus();
      else area?.querySelector<HTMLElement>('[aria-label="Message"]')?.focus();
    });
  };
  const hidePanel = () => {
    setPanelShown(false);
    if (openId) closeThread();
  };

  // Report notes link to their thread as `#thread=<id>`; open it here instead of navigating.
  const onLinkClick = (e: MouseEvent) => {
    const id = threadIdFromHref(
      (e.target as HTMLElement).closest('a')?.getAttribute('href') ?? null,
    );
    if (!id) return;
    e.preventDefault();
    openPanel(id);
  };

  // While a thread is working or queued, re-read statuses (one waiting on the person changes
  // only when they act, in that thread). When one changes, its report has landed in the chat
  // (reload it unless it is mid-turn, which reloads anyway), and an open thread has moved on
  // (reload it unless it is streaming its own turn).
  const statuses = projectThreads.map((t) => `${t.id}:${t.status}`).join();
  const active = /:(working|queued)(,|$)/.test(statuses) || threadRunning;
  const threadBusy = thread.status === 'streaming';
  const lastStatuses = useRef(statuses);
  // A report that landed during a chat turn is shown once the turn ends.
  const mainStale = useRef(false);
  useEffect(() => {
    if (mainBusy || !mainStale.current || !mainId) return;
    mainStale.current = false;
    void openInMain(mainId);
  }, [mainBusy, mainId, openInMain]);
  useEffect(() => {
    const before = lastStatuses.current;
    if (before === statuses) return;
    lastStatuses.current = statuses;
    mainStale.current = true;
    if (mainId && !mainBusy) {
      mainStale.current = false;
      void openInMain(mainId);
    }
    if (openId && !threadBusy) void open(openId);
  }, [statuses, mainId, mainBusy, openInMain, openId, threadBusy, open]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void refresh();
      if (openId && threadRunning && !threadBusy) void open(openId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh, openId, threadRunning, threadBusy, open]);

  // A page that links here as `/chat#thread=<id>` (a host's list of what threads made, say)
  // opens that thread once the list has it, then drops the hash so a reload starts clean.
  // After the status effect above, so its reload of the chat can't land over the linked
  // thread's. An id the list never has (a deleted thread) is dropped too.
  const [linked, setLinked] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setLinked(threadIdFromHref(window.location.hash));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const linkedReady = linked !== null && work.has(linked);
  const linkedGone = linked !== null && threads.length > 0 && !linkedReady;
  const openLinked = useRef(open);
  openLinked.current = open;
  useEffect(() => {
    if (!linked || (!linkedReady && !linkedGone)) return;
    setLinked(null);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (linkedReady) void openLinked.current(linked);
  }, [linkedReady, linkedGone, linked]);

  // Escape closes a panel that covers the chat: the open thread first, then the panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closeThread changes every render.
  useEffect(() => {
    if (!covered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openId) closeThread();
      else setPanelShown(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [covered, openId]);

  const chatTitle = chats.find((c) => c.id === mainId)?.title || 'Chat';
  const waiting = projectThreads.filter((t) => t.status === 'needs_you').length;

  const threadBody = openId && (
    // A new thread starts with its own empty box, not what was typed for the last one.
    <div key={openId} className="flex min-h-0 flex-1 flex-col">
      <ThreadChecklist
        // Live while this view streams the thread's turn; otherwise as the list last read it.
        tasks={thread.transcript.tasks.length > 0 ? thread.transcript.tasks : opened?.tasks}
      />
      <ChatView
        controller={thread}
        approvalViews={approvalViews}
        toolViews={toolViews}
        emptyText="This thread has no messages yet."
        working={threadRunning}
        onOpenThread={open}
        onLinkClick={onLinkClick}
        work={work}
        outputsOf={outputsOf}
      />
      <ProjectComposer
        controller={thread}
        label="Message this thread"
        placeholder={threadRunning ? 'This thread is working…' : 'Steer this thread…'}
        disabled={threadRunning}
        models={models}
        webSearch={webSearch}
      />
    </div>
  );

  return (
    <div ref={setArea} className={cn('relative flex h-full min-h-0', className)}>
      <section
        aria-label={`Chat: ${chatTitle}`}
        inert={covered}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {!panelOpen && (
          <button
            type="button"
            onClick={() => setPanelShown(true)}
            aria-label={waiting > 0 ? `Show threads, ${waiting} waiting on you` : 'Show threads'}
            title="Threads"
            className="absolute top-2 right-2 z-10 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelRightIcon className="size-4" aria-hidden />
            {waiting > 0 && (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-500" />
            )}
          </button>
        )}
        <ChatView
          controller={main}
          approvalViews={approvalViews}
          toolViews={toolViews}
          emptyText={emptyText}
          working={false}
          onOpenThread={openPanel}
          onLinkClick={onLinkClick}
          work={work}
          openThreadId={openId}
          outputsOf={outputsOf}
        />
        <ProjectComposer
          controller={main}
          placeholder={placeholder}
          models={models}
          webSearch={webSearch}
          mode={mode}
          toolsExtra={
            modes && modes.length > 1 ? (
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                aria-label="Mode"
                className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring"
              >
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : undefined
          }
        />
      </section>
      {panelOpen && (
        <ProjectPanel
          tab={tab}
          onTab={setTab}
          tabs={tabs}
          threads={projectThreads}
          openThreadId={openId}
          onOpenThread={openPanel}
          onResolveThread={(t, resolved) => void resolve(t, resolved)}
          outputsOf={outputsOf}
          thread={openId ? { item: opened, body: threadBody } : null}
          onCloseThread={closeThread}
          onHide={hidePanel}
          closeRef={panelClose}
          className={cn(
            'border-border bg-background',
            roomy ? 'w-[min(36rem,45%)] shrink-0 border-l' : 'absolute inset-0 z-20',
          )}
        />
      )}
    </div>
  );
}

/** The kit's one composer, sending to one conversation, with its usage in the footer. */
function ProjectComposer({
  controller,
  label,
  placeholder,
  disabled = false,
  models,
  webSearch,
  mode,
  toolsExtra,
}: {
  controller: UseAgentControllerChat;
  label?: string;
  placeholder: string;
  disabled?: boolean;
  models: ModelOption[] | false;
  webSearch: boolean;
  mode?: string | undefined;
  toolsExtra?: ReactNode;
}) {
  const { sendMessage, stop, status, transcript } = controller;
  return (
    <div className="mx-auto w-full max-w-2xl px-3 pb-3">
      <Composer
        className="m-0"
        {...(label ? { label } : {})}
        placeholder={placeholder}
        disabled={disabled}
        models={models}
        webSearch={webSearch}
        toolsExtra={toolsExtra}
        footerExtra={<UsageContext usage={transcript.usage} />}
        status={status === 'streaming' ? 'streaming' : status === 'error' ? 'error' : 'ready'}
        onStop={stop}
        onSend={(submit) => sendMessage(submit.text, turnOptions(submit, mode))}
      />
    </div>
  );
}

/**
 * The project's chat: the newest one there is (`isChat`, read once), opened into `main`. With
 * none, the first message makes it, and its id is picked up then.
 */
function useMainThread(
  main: UseAgentControllerChat,
  isChat: (t: ThreadItem) => boolean,
): string | null {
  const [mainId, setMainId] = useState<string | null>(null);
  const firstIsChat = useRef(isChat);
  // A chat the first message made while the list loaded stays the one on show.
  const settled = useRef(false);
  const picked = useRef(false);
  const { openThread, activeThreadId } = main;
  useEffect(() => {
    if (picked.current) return;
    picked.current = true;
    void (async () => {
      try {
        const res = await fetch('/api/agent-controller/threads', { cache: 'no-store' });
        const data = (await res.json()) as { threads?: ThreadItem[] };
        const first = (data.threads ?? []).find((t) => firstIsChat.current(t) && !t.archived);
        if (first && !settled.current) {
          settled.current = true;
          setMainId(first.id);
          await openThread(first.id);
        }
      } catch {
        // No history to show; the first message starts the chat.
      }
    })();
  }, [openThread]);
  // A first message with no chat open makes one: that is the chat now.
  useEffect(() => {
    if (mainId || !activeThreadId) return;
    settled.current = true;
    setMainId(activeThreadId);
  }, [mainId, activeThreadId]);
  return mainId;
}
