'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Conversation-history data for a chat shell — the `/api/agent-controller/threads*`
 * surface, owned by the engine rather than by any one view.
 *
 * This lives here, not in the sidebar component, so a second chat skin gets thread
 * listing, semantic search, rename/archive/delete and the optimistic-update +
 * rollback behaviour for free instead of reimplementing it (and drifting from the
 * first skin). See `bd mastra-chat-kit-h27`.
 *
 * Deliberately UI-free: no toast, no icons, no components. Mutations resolve to a
 * boolean so the SKIN decides how success and failure are shown — keeping this
 * module dependency-free on anything visual is what makes skins swappable at all.
 */

export type ThreadItem = {
  id: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SearchHit = { id: string; title: string; snippet: string; score: number };

/** Debounce any fast-changing value (the search input) without an extra dependency. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * @param refreshSignal bump to force a refetch — `useAgentControllerChat` increments
 * one each time a turn settles, so a new thread (and its generated title) appears.
 */
export function useThreads({ refreshSignal = 0 }: { refreshSignal?: number } = {}) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 250);
  const isSearching = debouncedSearch.length >= 2;
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-controller/threads', { cache: 'no-store' });
      const data = (await res.json()) as { threads?: ThreadItem[] };
      setThreads(data.threads ?? []);
    } catch {
      // History is non-critical; a failed refresh just keeps the last list.
    }
  }, []);

  // Reload on mount and whenever a turn finishes upstream.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshSignal is an intentional refetch trigger, not read in the body.
  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  // Debounced semantic search over message bodies (server-side fastembed).
  useEffect(() => {
    if (!isSearching) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    fetch(`/api/agent-controller/threads/search?q=${encodeURIComponent(debouncedSearch)}`, {
      cache: 'no-store',
    })
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

  /** PATCH a thread, applying `optimistic` immediately and rolling back on failure. */
  const patch = useCallback(
    async (id: string, body: Record<string, unknown>, optimistic: Partial<ThreadItem>) => {
      setThreads((prev) => prev.map((x) => (x.id === id ? { ...x, ...optimistic } : x)));
      try {
        const res = await fetch(`/api/agent-controller/threads/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        return true;
      } catch {
        void refresh();
        return false;
      }
    },
    [refresh],
  );

  /** Archive or restore. Call with `false` to undo an archive. */
  const archive = useCallback(
    (t: ThreadItem, nextArchived: boolean) =>
      patch(t.id, { archived: nextArchived }, { archived: nextArchived }),
    [patch],
  );

  /** Rename. No-ops (resolving true) when the title is blank or unchanged. */
  const rename = useCallback(
    async (t: ThreadItem, title: string) => {
      const next = title.trim();
      if (!next || next === t.title) return true;
      return patch(t.id, { title: next }, { title: next });
    },
    [patch],
  );

  const remove = useCallback(
    async (t: ThreadItem) => {
      setThreads((prev) => prev.filter((x) => x.id !== t.id));
      try {
        const res = await fetch(`/api/agent-controller/threads/${t.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(String(res.status));
        return true;
      } catch {
        void refresh();
        return false;
      }
    },
    [refresh],
  );

  return {
    threads,
    active,
    archived,
    search,
    setSearch,
    debouncedSearch,
    isSearching,
    searchHits,
    searching,
    refresh,
    archive,
    rename,
    remove,
  };
}

export type UseThreads = ReturnType<typeof useThreads>;
