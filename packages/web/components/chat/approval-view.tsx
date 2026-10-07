'use client';

import { createContext, type ReactNode, useContext } from 'react';
import type { PendingApproval } from '@/lib/agent-controller/events';

/**
 * # What an approval card says
 *
 * Every gated tool call stops at an approval card. By default the card names the tool in
 * words ("Create task") and lists its arguments as labelled fields. A host app can say it
 * better for its own tools with `approvalViews`, a renderer per tool name, passed to a chat
 * skin (`ChatPanel`, `ChatSwitcher`, `MinimalChat`) or straight to `ApprovalCard`:
 *
 *   <ChatPanel approvalViews={{
 *     createTask: ({ args }) => ({ title: `Add the task "${args.title}"` }),
 *   }} />
 *
 * A renderer gets the pending call (`toolName`, `args`, `category`) and the server's
 * `preview` when the host's agent server supplies one (`approvalPreview` in chat-server: a dry
 * run, or the record as it is now), so its body can show before and after. Returning null
 * falls back to the default card.
 */

export type ApprovalView = {
  /** The card's title, a plain sentence: "Update the Series page". */
  title: ReactNode;
  /** What the call will do, e.g. before → after. Omitted: the arguments as fields. */
  body?: ReactNode;
};

export type ApprovalRenderer = (approval: PendingApproval) => ApprovalView | null | undefined;

/** Renderers by tool name. */
export type ApprovalViews = Record<string, ApprovalRenderer>;

const ApprovalViewsContext = createContext<ApprovalViews>({});

/** Gives every approval card below it the host's renderers. */
export function ApprovalViewsProvider({
  views,
  children,
}: {
  views?: ApprovalViews;
  children: ReactNode;
}) {
  return (
    <ApprovalViewsContext.Provider value={views ?? {}}>{children}</ApprovalViewsContext.Provider>
  );
}

export function useApprovalViews() {
  return useContext(ApprovalViewsContext);
}

/**
 * A tool name in words: `createTask` → "Create task", `fluent-crm-upsert-contact` →
 * "Fluent crm upsert contact", `mastra_workspace_write_file` → "Mastra workspace write file".
 */
export function humanizeToolName(name: string) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  if (!words.length) return name;
  return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

/** The card a call gets: the host's view for its tool, or the default. */
export function approvalView(approval: PendingApproval, views: ApprovalViews): ApprovalView {
  const custom = views[approval.toolName]?.(approval);
  if (custom) return custom;
  return {
    title: `${humanizeToolName(approval.toolName)}?`,
    body: <ArgFields value={approval.args} />,
  };
}

const MAX_DEPTH = 3;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** One argument's value: text as text, lists of words joined, objects as nested fields. */
function FieldValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (typeof value !== 'object') {
    return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) {
      return <>{value.length ? value.map(String).join(', ') : '—'}</>;
    }
    if (depth >= MAX_DEPTH) return <code className="text-xs">{JSON.stringify(value)}</code>;
    return (
      <ol className="list-decimal space-y-1 pl-4">
        {value.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a static list of arguments
          <li key={i}>
            <FieldValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  if (depth >= MAX_DEPTH) return <code className="text-xs">{JSON.stringify(value)}</code>;
  return <ArgFields value={value} depth={depth + 1} />;
}

/** A call's arguments as labelled fields (the default card's body). */
export function ArgFields({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (!isRecord(value)) return <FieldValue value={value} depth={depth} />;
  const entries = Object.entries(value);
  if (!entries.length) return <p className="text-muted-foreground text-sm">No details.</p>;
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {entries.map(([key, v]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{humanizeToolName(key)}</dt>
          <dd className="min-w-0">
            <FieldValue value={v} depth={depth} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Before → after for one changed value, for host renderers. */
export function BeforeAfter({
  label,
  before,
  after,
}: {
  label?: ReactNode;
  before: ReactNode;
  after: ReactNode;
}) {
  return (
    <div className="space-y-1 text-sm">
      {label && <div className="text-muted-foreground text-xs">{label}</div>}
      <div className="rounded-md bg-muted/60 px-2 py-1 text-muted-foreground line-through decoration-muted-foreground/50">
        {before === null || before === undefined || before === '' ? '(empty)' : before}
      </div>
      <div className="rounded-md bg-primary/5 px-2 py-1">
        {after === null || after === undefined || after === '' ? '(empty)' : after}
      </div>
    </div>
  );
}
