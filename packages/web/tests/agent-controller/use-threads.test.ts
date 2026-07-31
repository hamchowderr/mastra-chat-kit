import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThreads } from '@/lib/agent-controller/use-threads';

/**
 * `useThreads` is the engine's conversation-history contract — the thing a second
 * chat skin inherits instead of reimplementing (bd h27). The risky part isn't the
 * listing, it's the optimistic mutations: the UI updates immediately and must roll
 * back if the server rejects. Nothing covered that before this refactor (the
 * sidebar has no test), so it is covered here rather than in any one skin.
 */

const THREADS = [
  { id: 't1', title: 'First', archived: false, createdAt: '2026-07-01', updatedAt: '2026-07-02' },
  { id: 't2', title: 'Old', archived: true, createdAt: '2026-06-01', updatedAt: '2026-06-02' },
];

/** Route fetches by URL so one mock serves the list, search and mutations. */
function mockApi({ mutationOk = true }: { mutationOk?: boolean } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'PATCH' || init?.method === 'DELETE') {
      return { ok: mutationOk, json: async () => ({}) } as Response;
    }
    if (url.includes('/threads/search')) {
      return {
        ok: true,
        json: async () => ({ threads: [{ id: 't1', title: 'First', snippet: 'hi', score: 0.9 }] }),
      } as Response;
    }
    return { ok: true, json: async () => ({ threads: THREADS }) } as Response;
  });
}

afterEach(() => vi.restoreAllMocks());

describe('useThreads', () => {
  it('loads threads on mount and splits active from archived', async () => {
    mockApi();
    const { result } = renderHook(() => useThreads());

    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    expect(result.current.active.map((t) => t.id)).toEqual(['t1']);
    expect(result.current.archived.map((t) => t.id)).toEqual(['t2']);
  });

  it('archives optimistically and reports success', async () => {
    mockApi();
    const { result } = renderHook(() => useThreads());
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.archive(THREADS[0], true);
    });

    expect(ok).toBe(true);
    expect(result.current.archived.map((t) => t.id)).toContain('t1');
  });

  it('rolls back to the server state when a mutation fails', async () => {
    mockApi({ mutationOk: false });
    const { result } = renderHook(() => useThreads());
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.remove(THREADS[0]);
    });

    // Reports failure, and the refetch restores the row the UI had dropped —
    // without this the sidebar silently loses a conversation that still exists.
    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.threads.map((t) => t.id)).toContain('t1'));
  });

  it('treats a blank or unchanged rename as a no-op without calling the server', async () => {
    const fetchSpy = mockApi();
    const { result } = renderHook(() => useThreads());
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    const callsAfterLoad = fetchSpy.mock.calls.length;

    await act(async () => {
      expect(await result.current.rename(THREADS[0], '   ')).toBe(true);
      expect(await result.current.rename(THREADS[0], 'First')).toBe(true);
    });

    expect(fetchSpy.mock.calls.length).toBe(callsAfterLoad);
  });

  it('only searches once the query passes the minimum length', async () => {
    mockApi();
    const { result } = renderHook(() => useThreads());
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    act(() => result.current.setSearch('a'));
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.searchHits).toEqual([]);

    act(() => result.current.setSearch('first'));
    await waitFor(() => expect(result.current.searchHits).toHaveLength(1));
    expect(result.current.searchHits[0].snippet).toBe('hi');
  });
});
