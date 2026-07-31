'use client';

import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BundledLanguage } from 'shiki';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { FileTree, FileTreeFile, FileTreeFolder } from '@/components/ai-elements/file-tree';
import type { UseAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';
import { type FileNode, useWorkspaceFiles } from '@/lib/agent-controller/use-workspace';
import { cn } from '@/lib/utils';

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

/**
 * Files tab — a live view of the controller agent's workspace (`WORKSPACE_ROOT`),
 * served straight off disk by `/api/workspace/*`. It keeps itself in sync
 * automatically — reloading on mount, polling while the agent is running (so writes
 * appear as they happen), and once more when the run finishes — so there's no manual
 * refresh to think about. Selecting a file loads its text into a CodeBlock.
 */
export function WorkbenchFiles({ controller }: { controller: UseAgentControllerChat }) {
  // Tree loading, streaming-poll and file reads live in the engine (bd h27), so a
  // second skin can surface the workspace without reimplementing any of it.
  const { tree, loadingTree, selected, content, loadingFile, selectPath, closeFile } =
    useWorkspaceFiles({
      status: controller.status,
    });

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
              onClick={closeFile}
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
