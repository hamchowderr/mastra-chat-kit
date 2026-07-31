'use client';

import { XIcon } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { BundledLanguage } from 'shiki';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { FileTree, FileTreeFile, FileTreeFolder } from '@/components/ai-elements/file-tree';
import type { UseAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';
import { cn } from '@/lib/utils';

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
 * Files tab — a live view of the controller agent's workspace (`WORKSPACE_ROOT`),
 * served straight off disk by `/api/workspace/*`. It keeps itself in sync
 * automatically — reloading on mount, polling while the agent is running (so writes
 * appear as they happen), and once more when the run finishes — so there's no manual
 * refresh to think about. Selecting a file loads its text into a CodeBlock.
 */
export function WorkbenchFiles({ controller }: { controller: UseAgentControllerChat }) {
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

  // While the agent is running, poll so files it writes appear live; the effect's
  // cleanup also fires the final reload on the streaming→ready transition, so the
  // tree settles on the finished state. No manual refresh needed.
  useEffect(() => {
    if (controller.status !== 'streaming') return;
    const id = setInterval(loadTree, 2000);
    return () => {
      clearInterval(id);
      loadTree();
    };
  }, [controller.status, loadTree]);

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
        {loadingTree && (
          <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">
            Syncing…
          </span>
        )}
      </div>

      {tree.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground text-sm">
          The workspace is empty — files the agent creates appear here.
        </div>
      ) : (
        // When a file is open, cap the tree to a small slice (scrolls if long) so the file
        // viewer below gets the majority of the height; otherwise the tree fills the panel.
        <div className={cn('overflow-auto', selected ? 'max-h-[32%] shrink-0' : 'min-h-0 flex-1')}>
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
              // Soft-wrap long lines so prose/long code flows DOWN instead of scrolling
              // sideways off the narrow panel. Targets the inner <pre> so the shared
              // CodeBlock used elsewhere keeps its default (horizontal-scroll) behavior.
              <CodeBlock
                code={content}
                language={langFor(selected)}
                showLineNumbers
                className="[&_pre]:whitespace-pre-wrap [&_pre]:break-words"
              />
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
