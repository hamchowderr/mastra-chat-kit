'use client';

import { RefreshCwIcon, XIcon } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { BundledLanguage } from 'shiki';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { FileTree, FileTreeFile, FileTreeFolder } from '@/components/ai-elements/file-tree';
import type { UseHarnessChat } from '@/lib/harness/use-harness-chat';

type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
};

/** Map a filename to a Shiki language, defaulting to plain text. */
const EXT_LANG: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  sh: 'bash',
  bash: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  java: 'java',
};

function langFor(name: string): BundledLanguage {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? ('text' as BundledLanguage);
}

/** Collect every file path in the tree (so we only load content for files). */
function collectFilePaths(nodes: FileNode[], acc: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.type === 'file') acc.add(n.path);
    else if (n.children) collectFilePaths(n.children, acc);
  }
  return acc;
}

/**
 * Files tab — a live view of the harness agent's workspace (`WORKSPACE_ROOT`),
 * served straight off disk by `/api/workspace/*`. Refreshes on mount, on demand,
 * and whenever a run finishes (so the agent's writes show up). Selecting a file
 * loads its text into a CodeBlock.
 */
export function WorkbenchFiles({ harness }: { harness: UseHarnessChat }) {
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

  // Initial load.
  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Re-read the tree when a run finishes — the agent may have written files.
  const prevStatus = useRef(harness.status);
  useEffect(() => {
    if (prevStatus.current === 'streaming' && harness.status === 'ready') {
      loadTree();
    }
    prevStatus.current = harness.status;
  }, [harness.status, loadTree]);

  const selectPath = useCallback(
    async (p: string) => {
      // FileTree fires onSelect for folders too — only load content for files.
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

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Workspace</span>
        <button
          type="button"
          aria-label="Refresh files"
          onClick={loadTree}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <RefreshCwIcon className={loadingTree ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </button>
      </div>

      {tree.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground text-sm">
          The workspace is empty — files the agent creates appear here.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <FileTree
            defaultExpanded={new Set(tree.filter((n) => n.type === 'dir').map((n) => n.path))}
            selectedPath={selected ?? undefined}
            onSelect={selectPath}
          >
            {renderNodes(tree)}
          </FileTree>
        </div>
      )}

      {selected && (
        <div className="flex min-h-0 flex-1 flex-col gap-1 border-border border-t pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs" title={selected}>
              {selected}
            </span>
            <button
              type="button"
              aria-label="Close file"
              onClick={() => setSelected(null)}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loadingFile ? (
              <p className="text-muted-foreground text-xs">Loading…</p>
            ) : content !== null ? (
              <CodeBlock code={content} language={langFor(selected)} showLineNumbers />
            ) : (
              <p className="text-destructive text-xs">Could not read this file.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function renderNodes(nodes: FileNode[]): ReactNode {
  return nodes.map((n) =>
    n.type === 'dir' ? (
      <FileTreeFolder key={n.path} path={n.path} name={n.name}>
        {n.children && renderNodes(n.children)}
      </FileTreeFolder>
    ) : (
      <FileTreeFile key={n.path} path={n.path} name={n.name} />
    ),
  );
}
