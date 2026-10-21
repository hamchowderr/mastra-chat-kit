'use client';

import { MoreHorizontalIcon, PencilIcon, SquarePenIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ThreadItem } from '@/lib/agent-controller/use-threads';
import { cn } from '@/lib/utils';
import { ThreadStatus } from './thread-row';

/**
 * The project chat's list: New chat, then every chat, newest first, with the threads each one
 * started under it. A chat can be renamed (or double-clicked) and deleted, which deletes its
 * threads too. Picking a thread opens it; picking a chat goes back to that chat.
 */
export function ProjectSidebar({
  chats,
  threadsOf,
  activeChatId,
  openThreadId,
  onSelectChat,
  onOpenThread,
  onNew,
  onRename,
  onDelete,
  busy = false,
  className,
}: {
  chats: ThreadItem[];
  /** Each chat's threads, by the chat's id, oldest first. */
  threadsOf: Map<string, ThreadItem[]>;
  activeChatId: string | null;
  openThreadId: string | null;
  onSelectChat: (id: string) => void;
  onOpenThread: (id: string) => void;
  onNew: () => void;
  onRename: (chat: ThreadItem, title: string) => Promise<boolean>;
  /** Resolves to false when the chat could not be deleted (a thread in it is working). */
  onDelete: (chat: ThreadItem) => Promise<boolean>;
  /** The chat on show is answering: switching chats waits until it is done. */
  busy?: boolean;
  className?: string;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <aside id="project-chats" className={cn('flex min-h-0 flex-col', className)}>
      <div className="p-2">
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          title={busy ? 'Wait for the answer to finish' : undefined}
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 font-medium text-sm shadow-xs transition-[scale,background-color] hover:bg-accent enabled:active:scale-[0.98] disabled:opacity-60"
        >
          <SquarePenIcon className="size-4" aria-hidden />
          New chat
        </button>
      </div>
      {problem && (
        <p role="alert" className="px-3 pb-2 text-destructive text-xs">
          {problem}
        </p>
      )}
      <nav aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chats.length === 0 && (
          <p className="px-2 py-2 text-pretty text-muted-foreground text-xs">
            Your chats show up here once you start one.
          </p>
        )}
        {chats.map((chat) => (
          <div key={chat.id} className="mb-0.5">
            <ChatRow
              chat={chat}
              active={chat.id === activeChatId && !openThreadId}
              locked={busy && chat.id !== activeChatId}
              answering={busy && chat.id === activeChatId}
              onSelect={() => onSelectChat(chat.id)}
              onRename={async (title) => {
                setProblem(null);
                if (!(await onRename(chat, title))) setProblem("Couldn't rename that chat.");
              }}
              onDelete={async () => {
                setProblem(null);
                if (!(await onDelete(chat))) {
                  setProblem("Couldn't delete that chat. A thread in it may still be working.");
                }
              }}
            />
            {(threadsOf.get(chat.id) ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpenThread(t.id)}
                // A thread opens over its own chat, which waits while another chat answers.
                disabled={busy && chat.id !== activeChatId}
                aria-current={t.id === openThreadId ? 'page' : undefined}
                className={cn(
                  'ml-3 flex h-8 w-[calc(100%-0.75rem)] items-center gap-2 rounded-md border-border border-l pr-2 pl-3 text-left text-sm transition-colors',
                  t.id === openThreadId
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground enabled:hover:bg-accent/60 enabled:hover:text-foreground disabled:opacity-60',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{t.title || 'Thread'}</span>
                <ThreadStatus status={t.status} compact />
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function ChatRow({
  chat,
  active,
  locked,
  answering,
  onSelect,
  onRename,
  onDelete,
}: {
  chat: ThreadItem;
  active: boolean;
  /** Another chat is answering, so this one can't be opened yet. */
  locked: boolean;
  /** This chat is answering now, so it can't be deleted until it is done. */
  answering: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const input = useRef<HTMLInputElement>(null);

  // Select the title once when renaming starts, not on every keystroke.
  useEffect(() => {
    if (!renaming) return;
    input.current?.focus();
    input.current?.select();
  }, [renaming]);

  const startRename = () => {
    setDraft(chat.title);
    setRenaming(true);
  };
  const commit = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== chat.title) void onRename(next);
  };

  if (renaming) {
    return (
      <div className="flex items-center rounded-lg bg-accent/60 px-2">
        <input
          ref={input}
          value={draft}
          aria-label="Chat name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setRenaming(false);
          }}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm">
        <p className="text-pretty">Delete “{chat.title || 'New chat'}” and its threads?</p>
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              void onDelete();
            }}
            className="h-7 rounded-md bg-destructive px-2.5 font-medium text-white text-xs transition-[scale] active:scale-[0.96]"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-7 rounded-md border border-border px-2.5 font-medium text-xs transition-[scale] active:scale-[0.96]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex items-center rounded-lg pr-1 transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={startRename}
        disabled={locked}
        title={locked ? 'Wait for the answer to finish' : undefined}
        aria-current={active ? 'page' : undefined}
        className="flex h-9 min-w-0 flex-1 items-center px-2 text-left text-sm disabled:opacity-60"
      >
        <span className="truncate">{chat.title || 'New chat'}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${chat.title || 'this chat'}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={startRename}>
            <PencilIcon className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={answering}
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
