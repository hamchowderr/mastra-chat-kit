'use client';

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type ThreadItem = {
  id: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};
type SearchHit = { id: string; title: string; snippet: string; score: number };

/** Debounce any fast-changing value (search input) without an extra dependency. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const DAY = 86_400_000;
const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'] as const;

function groupOf(ts: number, todayStart: number): (typeof GROUP_ORDER)[number] {
  if (ts >= todayStart) return 'Today';
  if (ts >= todayStart - DAY) return 'Yesterday';
  if (ts >= todayStart - 7 * DAY) return 'Previous 7 days';
  if (ts >= todayStart - 30 * DAY) return 'Previous 30 days';
  return 'Older';
}

/**
 * Chat-history sidebar (Mastra threads for the single local user). Foreman-style
 * collapsible left rail: new-chat, debounced semantic search (fastembed →
 * PgVector), date-grouped chat list, and per-chat archive/delete. The parent
 * (`ChatApp`) owns `activeThreadId`; this component only reads/mutates the list
 * and reports selections back up. `refreshSignal` bumps whenever a chat turn
 * finishes so a freshly-created thread (and its AI title) shows up.
 */
export function ChatSidebar({
  activeThreadId,
  onSelect,
  onNew,
  refreshSignal,
  collapsed,
}: {
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  refreshSignal: number;
  collapsed: boolean;
}) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ThreadItem | null>(null);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 250);
  const isSearching = debouncedSearch.length >= 2;
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/threads', { cache: 'no-store' });
      const data = (await res.json()) as { threads?: ThreadItem[] };
      setThreads(data.threads ?? []);
    } catch {
      // Sidebar is non-critical; a failed refresh just keeps the last list.
    }
  }, []);

  // Reload the list on mount and whenever a turn finishes upstream.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshSignal is an intentional refetch trigger, not read in the body.
  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  // Debounced semantic search.
  useEffect(() => {
    if (!isSearching) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    fetch(`/api/threads/search?q=${encodeURIComponent(debouncedSearch)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { threads?: SearchHit[] }) => {
        if (!cancelled) setSearchHits(data.threads ?? []);
      })
      .catch(() => {
        if (!cancelled) setSearchHits([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, isSearching]);

  const active = useMemo(() => threads.filter((t) => !t.archived), [threads]);
  const archived = useMemo(() => threads.filter((t) => t.archived), [threads]);

  // Active chats grouped by last-activity day, in fixed order.
  const groups = useMemo(() => {
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const buckets = new Map<string, ThreadItem[]>();
    for (const t of active) {
      const label = groupOf(+new Date(t.updatedAt ?? t.createdAt ?? todayStart), todayStart);
      const arr = buckets.get(label) ?? [];
      arr.push(t);
      buckets.set(label, arr);
    }
    return GROUP_ORDER.map((label) => ({ label, items: buckets.get(label) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [active]);

  const handleArchive = async (t: ThreadItem, nextArchived: boolean) => {
    setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, archived: nextArchived } : x)));
    try {
      const res = await fetch(`/api/threads/${t.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: nextArchived }),
      });
      if (!res.ok) throw new Error(`archive failed (${res.status})`);
      if (nextArchived) {
        toast.success('Chat archived', {
          action: { label: 'Undo', onClick: () => handleArchive(t, false) },
        });
      } else {
        toast.success('Chat restored');
      }
    } catch {
      toast.error(nextArchived ? 'Failed to archive chat' : 'Failed to restore chat');
      void refresh();
    }
  };

  const handleRename = async (t: ThreadItem, title: string) => {
    const next = title.trim();
    if (!next || next === t.title) {
      return;
    }
    setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, title: next } : x)));
    try {
      const res = await fetch(`/api/threads/${t.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error(`rename failed (${res.status})`);
      toast.success('Chat renamed');
    } catch {
      toast.error('Failed to rename chat');
      void refresh();
    }
  };

  const handleDelete = async (t: ThreadItem) => {
    setPendingDelete(null);
    setThreads((prev) => prev.filter((x) => x.id !== t.id));
    try {
      const res = await fetch(`/api/threads/${t.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      toast.success('Chat deleted');
      if (t.id === activeThreadId) onNew();
    } catch {
      toast.error('Failed to delete chat');
      void refresh();
    }
  };

  return (
    <aside
      className={cn(
        'shrink-0 overflow-hidden border-border bg-muted/30 transition-[width] duration-200 ease-out',
        collapsed ? 'w-0' : 'w-72 border-r',
      )}
    >
      <div className="flex h-full w-72 flex-col">
        {/* New chat */}
        <div className="p-2">
          <button
            type="button"
            onClick={() => {
              setSearch('');
              onNew();
            }}
            className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 font-medium text-sm shadow-sm transition-[scale,background-color] hover:bg-accent active:scale-[0.98]"
          >
            <SquarePenIcon className="size-4" />
            New chat
          </button>
        </div>

        {/* Search */}
        <div className="px-2 pb-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Search chats"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="h-9 w-full rounded-lg border border-border bg-background pr-8 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="-translate-y-1/2 absolute top-1/2 right-1 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[scale,color] hover:text-foreground active:scale-[0.96]"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {isSearching ? (
            <Section label={searching ? 'Searching…' : 'Results'}>
              {searchHits.length === 0 && !searching ? (
                <Empty>No matches for “{debouncedSearch}”</Empty>
              ) : (
                searchHits.map((h) => (
                  <SearchRow
                    key={h.id}
                    hit={h}
                    isActive={h.id === activeThreadId}
                    onClick={() => {
                      onSelect(h.id);
                      setSearch('');
                    }}
                  />
                ))
              )}
            </Section>
          ) : (
            <>
              {active.length === 0 && (
                <Empty>Your chats will appear here once you start chatting.</Empty>
              )}
              {groups.map((g) => (
                <Section key={g.label} label={g.label}>
                  {g.items.map((t) => (
                    <ChatRow
                      key={t.id}
                      thread={t}
                      isActive={t.id === activeThreadId}
                      onClick={() => onSelect(t.id)}
                      onArchive={() => handleArchive(t, true)}
                      onRename={(title) => handleRename(t, title)}
                      onDelete={() => setPendingDelete(t)}
                    />
                  ))}
                </Section>
              ))}

              {archived.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    className="flex h-9 w-full items-center gap-2 rounded-md px-2 font-medium text-muted-foreground text-xs uppercase tracking-wide transition-colors hover:text-foreground"
                  >
                    <ArchiveIcon className="size-3.5" />
                    {showArchived ? 'Hide archived' : `Archived (${archived.length})`}
                  </button>
                  {showArchived &&
                    archived.map((t) => (
                      <ChatRow
                        key={t.id}
                        thread={t}
                        isActive={t.id === activeThreadId}
                        onClick={() => onSelect(t.id)}
                        onArchive={() => handleArchive(t, false)}
                        onRename={(title) => handleRename(t, title)}
                        onDelete={() => setPendingDelete(t)}
                        archivedRow
                      />
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this chat?</DialogTitle>
            <DialogDescription>
              This permanently deletes “{pendingDelete?.title}” and its messages. This can’t be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="h-9 rounded-lg border border-border px-4 font-medium text-sm transition-[scale] active:scale-[0.96]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => pendingDelete && handleDelete(pendingDelete)}
              className="h-9 rounded-lg bg-destructive px-4 font-medium text-destructive-foreground text-sm transition-[scale] active:scale-[0.96]"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase tracking-[0.12em]">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-pretty px-2 py-2 text-muted-foreground text-xs">{children}</div>;
}

function ChatRow({
  thread,
  isActive,
  onClick,
  onArchive,
  onRename,
  onDelete,
  archivedRow,
}: {
  thread: ThreadItem;
  isActive: boolean;
  onClick: () => void;
  onArchive: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  archivedRow?: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(thread.title);

  const startRename = () => {
    setDraft(thread.title);
    setRenaming(true);
  };
  const commit = () => {
    setRenaming(false);
    onRename(draft);
  };

  if (renaming) {
    return (
      <div className="flex items-center rounded-lg bg-accent/60 px-2">
        <input
          ref={(el) => {
            if (el) {
              el.focus();
              el.select();
            }
          }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
            } else if (e.key === 'Escape') {
              setRenaming(false);
            }
          }}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex items-center rounded-lg pr-1 transition-colors',
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={startRename}
        className="flex h-10 min-w-0 flex-1 items-center px-2 text-left text-sm"
      >
        <span className="truncate">{thread.title}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Chat actions"
            onClick={(e) => e.stopPropagation()}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[scale,opacity,color] hover:text-foreground focus-visible:opacity-100 active:scale-[0.96] group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={startRename}>
            <PencilIcon className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onArchive}>
            {archivedRow ? (
              <>
                <ArchiveRestoreIcon className="size-4" />
                Restore
              </>
            ) : (
              <>
                <ArchiveIcon className="size-4" />
                Archive
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2Icon className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SearchRow({
  hit,
  isActive,
  onClick,
}: {
  hit: SearchHit;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-10 w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors',
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <span className="w-full truncate text-sm">{hit.title}</span>
      {hit.snippet && (
        <span className="w-full truncate text-muted-foreground text-xs">{hit.snippet}</span>
      )}
    </button>
  );
}
