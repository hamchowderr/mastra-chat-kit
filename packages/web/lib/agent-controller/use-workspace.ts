'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The agent's workspace as data — `/api/workspace/*` (the real `WORKSPACE_ROOT`
 * directory on the server) plus the generated-image store.
 *
 * Owned by the engine, not by the Files panel, so a second chat skin can surface
 * workspace contents without reimplementing the polling-while-streaming behaviour.
 * See `bd mastra-chat-kit-h27`.
 *
 * UI-free by design: returns data and loading flags, renders nothing.
 */

export type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
};

/** Flatten a tree to the set of paths that are FILES (folders are not readable). */
export function collectFilePaths(nodes: FileNode[], acc = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.type === 'file') acc.add(n.path);
    if (n.children) collectFilePaths(n.children, acc);
  }
  return acc;
}

/**
 * @param status the controller's run status — while `streaming`, the tree polls so
 * files the agent writes appear live, then reloads once more on settle.
 */
export function useWorkspaceFiles({ status }: { status?: string } = {}) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    try {
      const res = await fetch('/api/workspace/files');
      if (res.ok) {
        const data = (await res.json()) as { tree?: FileNode[] };
        setTree(data.tree ?? []);
      }
    } catch {
      // best-effort; leave the previous tree in place
    } finally {
      setLoadingTree(false);
    }
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // While the agent runs, poll so its writes appear live; the cleanup also fires the
  // final reload on the streaming→ready transition, so the tree settles on the
  // finished state. No manual refresh to think about.
  useEffect(() => {
    if (status !== 'streaming') return;
    const id = setInterval(loadTree, 2000);
    return () => {
      clearInterval(id);
      void loadTree();
    };
  }, [status, loadTree]);

  /** Select a path and load its text. Ignores folders (FileTree fires for those too). */
  const selectPath = useCallback(
    async (p: string) => {
      if (!collectFilePaths(tree).has(p)) return;
      setSelected(p);
      setContent(null);
      setLoadingFile(true);
      try {
        const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(p)}`);
        setContent(res.ok ? ((await res.json()) as { content: string }).content : null);
      } catch {
        setContent(null);
      } finally {
        setLoadingFile(false);
      }
    },
    [tree],
  );

  /** Close the open file (back to just the tree). */
  const closeFile = useCallback(() => {
    setSelected(null);
    setContent(null);
  }, []);

  return { tree, loadingTree, loadTree, selected, content, loadingFile, selectPath, closeFile };
}

export type UseWorkspaceFiles = ReturnType<typeof useWorkspaceFiles>;

/**
 * Resolve a generated image by id. `generateImage` returns only a tiny `imageId`
 * (a full base64 would overflow the model context), so the bytes are fetched from
 * `/api/images/:id` at render time. Pass `base64` directly to skip the fetch.
 */
export function useGeneratedImage({
  imageId,
  base64,
  mediaType,
}: {
  imageId?: string;
  base64?: string;
  mediaType: string;
}) {
  const [data, setData] = useState<{ base64: string; mediaType: string } | null>(
    base64 ? { base64, mediaType } : null,
  );

  useEffect(() => {
    if (data || !imageId) return;
    let active = true;
    fetch(`/api/images/${imageId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d?.base64) {
          setData({ base64: d.base64, mediaType: d.mediaType ?? mediaType });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [imageId, data, mediaType]);

  return data;
}
