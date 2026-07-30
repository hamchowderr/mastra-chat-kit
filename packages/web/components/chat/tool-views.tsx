'use client';

import { CheckIcon, MessageCircleQuestionMarkIcon, TargetIcon, XIcon } from 'lucide-react';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import { FileTree, FileTreeFile, FileTreeFolder } from '@/components/ai-elements/file-tree';
import { Image } from '@/components/ai-elements/image';
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselItem,
  InlineCitationSource,
  InlineCitationText,
} from '@/components/ai-elements/inline-citation';
import { MessageResponse } from '@/components/ai-elements/message';
import {
  Plan,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
} from '@/components/ai-elements/plan';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';
import {
  Terminal,
  TerminalContent,
  TerminalHeader,
  TerminalTitle,
} from '@/components/ai-elements/terminal';
import type { AgentControllerGoal, PendingSuspension } from '@/lib/agent-controller/events';
import { cn } from '@/lib/utils';

/**
 * Shared renderers that turn real agent TOOL output into the matching AI Elements,
 * used by BOTH the Single Agent and Agent Controller chat views so they never drift.
 * Each takes the real data a tool produced — no static/example props.
 */

export type KnowledgeResult = { title: string; url: string; snippet?: string };

/** Real `searchKnowledge` results → Sources list + inline citations. */
export function KnowledgeSources({ results }: { results: KnowledgeResult[] }) {
  if (!results?.length) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <Sources>
        <SourcesTrigger count={results.length} />
        <SourcesContent>
          {results.map((r) => (
            <Source key={r.url} href={r.url} title={r.title} />
          ))}
        </SourcesContent>
      </Sources>
      <p className="text-muted-foreground text-sm">
        Citations:{' '}
        {results.map((r, i) => (
          <InlineCitation key={r.url}>
            <InlineCitationText>[{i + 1}]</InlineCitationText>
            <InlineCitationCard>
              <InlineCitationCardTrigger sources={[r.url]} />
              <InlineCitationCardBody>
                <InlineCitationCarousel>
                  <InlineCitationCarouselContent>
                    <InlineCitationCarouselItem>
                      <InlineCitationSource title={r.title} url={r.url} description={r.snippet} />
                    </InlineCitationCarouselItem>
                  </InlineCitationCarouselContent>
                </InlineCitationCarousel>
              </InlineCitationCardBody>
            </InlineCitationCard>
          </InlineCitation>
        ))}
      </p>
    </div>
  );
}

/**
 * Real `generateImage` output → the Image element. The agent returns only a small
 * `imageId` (the bytes never enter the model context); we fetch the base64 from
 * `/api/images/:id` and feed it to <Image>. A direct `base64` is also supported.
 */
export function GeneratedImage({
  imageId,
  base64,
  mediaType = 'image/webp',
  prompt,
}: {
  imageId?: string;
  base64?: string;
  mediaType?: string;
  prompt?: string;
}) {
  const [data, setData] = useState<{ base64: string; mediaType: string } | null>(
    base64 ? { base64, mediaType } : null,
  );

  useEffect(() => {
    if (data || !imageId) {
      return;
    }
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

  if (!data?.base64) {
    return <p className="text-muted-foreground text-xs">Loading generated image…</p>;
  }
  return (
    <Image
      base64={data.base64}
      mediaType={data.mediaType}
      alt={prompt ?? 'Generated image'}
      // Subtle pure-black/white outline (not a tinted neutral, which reads as dirt
      // on the image edge); ring follows the rounded corners.
      className="max-w-sm rounded-md ring-1 ring-black/10 ring-inset dark:ring-white/10"
    />
  );
}

/** Real `submit_plan` tool args → the Plan element. */
export function PlanCard({ title, plan }: { title?: string; plan: string }) {
  return (
    <Plan>
      <PlanHeader>
        <PlanTitle>{title ?? 'Plan'}</PlanTitle>
        <PlanDescription>Proposed by the agent</PlanDescription>
      </PlanHeader>
      <PlanContent>
        <MessageResponse>{plan}</MessageResponse>
      </PlanContent>
    </Plan>
  );
}

/**
 * Goal-run card: the objective the agent is iterating toward, its progress against the
 * run budget, the judge's verdict, and the latest judge reason. Driven by `goal_evaluation`
 * events (see reduceAgentControllerEvent); seeded optimistically by setGoal. `onClear` renders a
 * clear control. States: passed (judge complete) / paused (waiting for the user) / working.
 */
export function GoalCard({ goal, onClear }: { goal: AgentControllerGoal; onClear?: () => void }) {
  const passed = goal.passed === true || goal.status === 'done';
  const waiting = goal.waitingForUser === true;
  const paused = !passed && (waiting || goal.status === 'paused' || goal.maxRunsReached === true);
  const working = !passed && !paused;
  const iteration = goal.iteration ?? 0;
  const maxRuns = goal.maxRuns;
  const pct =
    maxRuns && maxRuns > 0 ? Math.min(100, Math.round((iteration / maxRuns) * 100)) : null;

  const statusLabel = passed
    ? 'Passed'
    : waiting
      ? 'Waiting for you'
      : goal.maxRunsReached
        ? 'Budget reached'
        : goal.status === 'paused'
          ? 'Paused'
          : 'Working…';

  return (
    // Outer radius rounded-xl (12px); the icon chip is rounded-lg (8px) and the progress
    // track rounded-full — concentric, so nested corners never fight.
    <div className="my-3 rounded-xl border border-border bg-card p-4 text-pretty shadow-[var(--shadow-float)]">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            passed
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : paused
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-primary/10 text-primary',
          )}
        >
          {passed ? <CheckIcon className="size-4" /> : <TargetIcon className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Goal
            </p>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px]',
                passed
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : paused
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'animate-pulse bg-muted text-muted-foreground',
              )}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-pretty text-sm">{goal.objective}</p>
        </div>
        {onClear && (
          // 40×40 hit area via padding around a size-4 glyph; scale-on-press feedback.
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear goal"
            className="-m-2 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.96]"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      {(pct !== null || iteration > 0) && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500',
                passed ? 'bg-emerald-500' : paused ? 'bg-amber-500' : 'bg-primary',
              )}
              style={{ width: `${pct ?? (working ? 100 : 0)}%` }}
            />
          </div>
          {/* Dynamically updating counter → tabular-nums so the bar never shifts. */}
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
            {iteration}
            {maxRuns ? ` / ${maxRuns}` : ''}
          </span>
        </div>
      )}

      {goal.reason && (
        <p className="mt-2 text-pretty text-muted-foreground text-xs">{goal.reason}</p>
      )}
    </div>
  );
}

/**
 * `ask_user` prompt: the agent paused to ask a clarifying question and the run is
 * suspended awaiting the answer (see the `tool_suspended` reducer). Renders one of
 * three shapes from the suspend payload — free-text (a textarea), single-select
 * (choice buttons that answer on click), or multi-select (toggle chips + Send). The
 * answer resumes the suspended tool (POST /api/agent-controller/answer) and the run continues
 * on the still-open SSE. Focuses the input on mount so answering is immediate.
 */
export function AskUserPrompt({
  suspension,
  onAnswer,
}: {
  suspension: PendingSuspension;
  onAnswer: (answer: string | string[], toolCallId?: string) => void;
}) {
  const { question, options, selectionMode, toolCallId } = suspension;
  const hasOptions = Array.isArray(options) && options.length > 0;
  const isMulti = selectionMode === 'multi_select';
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus the free-text input once when the prompt appears (ref+effect, not
  // autoFocus, so it's a one-shot and doesn't fight re-renders).
  useEffect(() => {
    if (!hasOptions) inputRef.current?.focus();
  }, [hasOptions]);

  const submitText = () => {
    const v = text.trim();
    if (v) onAnswer(v, toolCallId);
  };
  const toggle = (label: string) =>
    setPicked((cur) => (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]));

  return (
    // Concentric radii: outer rounded-xl (12px), inner controls rounded-lg (8px) — matches GoalCard.
    <div className="my-3 rounded-xl border border-border bg-card p-4 text-pretty shadow-[var(--shadow-float)]">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MessageCircleQuestionMarkIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Question
          </p>
          <p className="mt-1 text-pretty text-sm">{question}</p>
        </div>
      </div>

      {/* Answer controls, indented under the question text (32px chip + 12px gap). */}
      <div className="mt-3 pl-11">
        {hasOptions ? (
          isMulti ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {options.map((o) => {
                  const on = picked.includes(o.label);
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => toggle(o.label)}
                      title={o.description}
                      aria-pressed={on}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-sm transition-[background-color,border-color,color,scale] active:scale-[0.96]',
                        on
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => picked.length && onAnswer(picked, toolCallId)}
                  disabled={picked.length === 0}
                  className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm transition-[opacity,scale] active:scale-[0.96] disabled:opacity-50"
                >
                  Send{picked.length ? ` (${picked.length})` : ''}
                </button>
              </div>
            </div>
          ) : (
            // single-select: clicking a choice answers immediately.
            <div className="flex flex-wrap gap-2">
              {options.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => onAnswer(o.label, toolCallId)}
                  title={o.description}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-foreground text-sm transition-[background-color,border-color,scale] hover:border-primary hover:bg-primary/5 active:scale-[0.96]"
                >
                  {o.label}
                </button>
              ))}
            </div>
          )
        ) : (
          // free-text: Enter sends, Shift+Enter for a newline.
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              rows={1}
              placeholder="Type your answer…"
              className="min-h-9 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button"
              onClick={submitText}
              disabled={!text.trim()}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground text-sm transition-[opacity,scale] active:scale-[0.96] disabled:opacity-50"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Real step sequence (the agent's actual tool calls) → ChainOfThought. */
export function StepTrace({ steps }: { steps: string[] }) {
  if (!steps?.length) {
    return null;
  }
  return (
    <ChainOfThought defaultOpen>
      <ChainOfThoughtHeader>Steps</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {steps.map((label, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: step list is render-stable per message
          <ChainOfThoughtStep key={`${i}-${label}`} label={label} status="complete" />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

// ---------------------------------------------------------------------------
// Code Agent — Mastra workspace tool output → the Code AI Elements.
// The workspace tools (mastra_workspace_*) return formatted TEXT, so these
// renderers parse that text into the real File Tree / Terminal / Code Block
// elements. See packages/server/src/mastra/agents/code.ts.
// ---------------------------------------------------------------------------

const LANG_BY_EXT: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  md: 'md',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  sh: 'bash',
  bash: 'bash',
  css: 'css',
  html: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
};

type CodeLanguage = ComponentProps<typeof CodeBlock>['language'];

function languageFromPath(path?: string): CodeLanguage {
  const ext = path?.split('.').pop()?.toLowerCase() ?? '';
  return (LANG_BY_EXT[ext] ?? 'text') as CodeLanguage;
}

/** read_file output is `"<name> (<n> bytes)\n   1→<code>"` — strip the header + line-number gutter. */
function cleanReadFile(output: string): string {
  const lines = output.split('\n');
  const body = /^.+ \(\d+ bytes\)\s*$/.test(lines[0] ?? '') ? lines.slice(1) : lines;
  return body.map((l) => l.replace(/^\s*\d+→/, '')).join('\n');
}

type TreeNode = { name: string; path: string; children: TreeNode[] };

/** Parse the tab-indented `list_files` tree text into a nested structure. */
function parseFileTree(text: string): TreeNode[] {
  const lines = text
    .split('\n')
    .filter((l) => l.length > 0 && l.trim() !== '.' && !/^\d+ director(y|ies),/.test(l.trim()));
  const roots: TreeNode[] = [];
  const stack: { depth: number; node: TreeNode }[] = [];
  for (const line of lines) {
    const depth = line.match(/^\t*/)?.[0].length ?? 0;
    const name = line.replace(/^\t+/, '').trim();
    if (!name) {
      continue;
    }
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parent = stack.at(-1)?.node;
    const path = parent ? `${parent.path}/${name}` : name;
    const node: TreeNode = { name, path, children: [] };
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push({ depth, node });
  }
  return roots;
}

function collectFolderPaths(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children.length > 0) {
      acc.push(n.path);
      collectFolderPaths(n.children, acc);
    }
  }
  return acc;
}

function renderTreeNodes(nodes: TreeNode[]) {
  return nodes.map((n) =>
    n.children.length > 0 ? (
      <FileTreeFolder key={n.path} name={n.name} path={n.path}>
        {renderTreeNodes(n.children)}
      </FileTreeFolder>
    ) : (
      <FileTreeFile key={n.path} name={n.name} path={n.path} />
    ),
  );
}

/** `list_files` tree text → the File Tree element. */
export function WorkspaceFileTree({ tree }: { tree: string }) {
  const nodes = parseFileTree(tree);
  if (nodes.length === 0) {
    return <p className="text-muted-foreground text-xs">Empty workspace.</p>;
  }
  return (
    <FileTree defaultExpanded={new Set(collectFolderPaths(nodes))}>
      {renderTreeNodes(nodes)}
    </FileTree>
  );
}

/** `execute_command` → the Terminal element (renders `output` via context). */
export function WorkspaceTerminal({ title, output }: { title: string; output: string }) {
  return (
    <Terminal output={output || '(no output)'}>
      <TerminalHeader>
        <TerminalTitle>{title}</TerminalTitle>
      </TerminalHeader>
      <TerminalContent />
    </Terminal>
  );
}

/** read/write/edit file → the Code Block element. */
export function WorkspaceCodeBlock({ path, code }: { path?: string; code: string }) {
  return (
    <CodeBlock code={code} language={languageFromPath(path)} showLineNumbers>
      {path && <span className="px-1 font-mono text-muted-foreground text-xs">{path}</span>}
      <CodeBlockCopyButton />
    </CodeBlock>
  );
}

/**
 * Dispatch a Mastra workspace tool call to its Code element. Returns null for
 * tools without a dedicated element (mkdir/delete/stat) so the caller falls back
 * to the generic <Tool> view. `input`/`output` are whatever the tool produced.
 */
export function WorkspaceTool({
  toolName,
  input,
  output,
}: {
  toolName: string;
  input: unknown;
  output: unknown;
}) {
  const suffix = toolName.replace('mastra_workspace_', '');
  const inp = (input ?? {}) as {
    path?: string;
    command?: string;
    args?: string[];
    content?: string;
  };
  const out =
    typeof output === 'string' ? output : output != null ? JSON.stringify(output, null, 2) : '';

  if (suffix === 'list_files') {
    return out ? <WorkspaceFileTree tree={out} /> : null;
  }
  if (suffix === 'execute_command') {
    const title = [inp.command, ...(inp.args ?? [])].filter(Boolean).join(' ') || 'command';
    return <WorkspaceTerminal title={title} output={out} />;
  }
  if (suffix === 'read_file') {
    return out ? <WorkspaceCodeBlock path={inp.path} code={cleanReadFile(out)} /> : null;
  }
  if (suffix === 'write_file' || suffix === 'edit_file') {
    const code = typeof inp.content === 'string' ? inp.content : cleanReadFile(out);
    return code ? <WorkspaceCodeBlock path={inp.path} code={code} /> : null;
  }
  if (suffix === 'grep') {
    return <WorkspaceTerminal title={`grep ${inp.path ?? ''}`.trim()} output={out} />;
  }
  return null;
}

/** True for any Mastra workspace tool part (`tool-mastra_workspace_*`). */
export function isWorkspaceTool(toolName?: string): boolean {
  return typeof toolName === 'string' && toolName.startsWith('mastra_workspace_');
}

const WORKSPACE_VIEW_SUFFIXES = new Set([
  'list_files',
  'execute_command',
  'read_file',
  'write_file',
  'edit_file',
  'grep',
]);

/** True only for workspace tools that have a dedicated Code element renderer. */
export function hasWorkspaceView(toolName?: string): boolean {
  if (!isWorkspaceTool(toolName)) {
    return false;
  }
  return WORKSPACE_VIEW_SUFFIXES.has((toolName as string).replace('mastra_workspace_', ''));
}
