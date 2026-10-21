'use client';

import { CheckIcon, CircleAlertIcon, CircleDashedIcon, LoaderCircleIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought';

/** One tool call in a message, as the transcript holds it. */
export type ToolCall = { id: string; name: string; args: unknown };
/** A tool call's result, once it has one. */
export type ToolResult = { result?: unknown; isError?: boolean };
/** Every tool call in the message being drawn, with its result, in order. */
export type ToolTurn = ReadonlyArray<{ call: ToolCall; result: ToolResult | undefined }>;

/**
 * A tool call told in a few words, e.g. "Edited app/page.tsx". `failed` marks a call whose
 * result says it went wrong (many tools return their error rather than throw it).
 */
export type ToolStep = { label: string; detail?: string; failed?: boolean };

/**
 * How a host shows its own tools in the chat, instead of the raw input and output.
 *
 * - `step`: a short row. Rows next to each other fold into one "N steps" list, so a run of
 *   twenty file edits reads as one line until opened.
 * - `card`: a card in place of the call, such as what a turn changed and a way back to it.
 *
 * Either returns null for a call it doesn't cover; that call then shows as a plain tool.
 */
export type ToolViews = {
  step?: (call: ToolCall, result: ToolResult | undefined) => ToolStep | null;
  card?: (call: ToolCall, result: ToolResult | undefined, turn: ToolTurn) => ReactNode;
};

/**
 * A step row as drawn: its words, and how its call went. `stopped` is a call that never got a
 * result because the turn ended first (stopped, or the stream broke).
 */
export type DrawnStep = ToolStep & {
  key: string;
  state: 'running' | 'done' | 'error' | 'stopped';
};

/**
 * A run of tool steps as one fold-out list. While a step is running the header names it;
 * once all are done the list folds to "N steps".
 */
export function ToolStepList({ steps }: { steps: DrawnStep[] }) {
  const running = steps.find((s) => s.state === 'running');
  const [open, setOpen] = useState(Boolean(running));
  const working = Boolean(running);
  // Open while it works, folded once it's done; the person can still open it again.
  useEffect(() => {
    setOpen(working);
  }, [working]);
  if (steps.length === 0) return null;
  const failed = steps.filter((s) => s.state === 'error').length;
  const header = running
    ? running.label
    : `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}${failed ? `, ${failed} failed` : ''}`;
  return (
    <ChainOfThought open={open} onOpenChange={setOpen} className="my-1">
      <ChainOfThoughtHeader>{header}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {steps.map((s) => (
          <ChainOfThoughtStep
            key={s.key}
            label={s.label}
            status={s.state === 'running' ? 'active' : 'complete'}
            icon={
              s.state === 'running'
                ? LoaderCircleIcon
                : s.state === 'error'
                  ? CircleAlertIcon
                  : s.state === 'stopped'
                    ? CircleDashedIcon
                    : CheckIcon
            }
            // The step's own icon is its first child's svg; a running one turns.
            className={s.state === 'running' ? '[&>div:first-child>svg]:animate-spin' : undefined}
            description={
              s.state === 'error' ? (
                <span className="text-destructive">{s.detail ?? 'This step failed.'}</span>
              ) : s.state === 'stopped' ? (
                "This step didn't finish."
              ) : (
                s.detail
              )
            }
          />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

/** One thing to draw in a message: a run of step rows, a host's card, or a plain part. */
export type MessagePiece<P> =
  | { kind: 'steps'; key: string; steps: DrawnStep[] }
  | { kind: 'card'; key: string; node: ReactNode }
  | { kind: 'part'; key: string; part: P; index: number };

/**
 * A message's parts, with the host's tools turned into step rows and cards. Steps next to
 * each other (results between them don't count) become one run; anything else ends it.
 * `live` says the message is still streaming, so a call without a result is running; once
 * it isn't, such a call never finished.
 */
export function messagePieces<P extends { type: string }>(
  messageId: string,
  parts: readonly P[],
  views: ToolViews | undefined,
  live: boolean,
): MessagePiece<P>[] {
  const results = new Map<string, ToolResult>();
  for (const p of parts) {
    if (p.type === 'tool_result') results.set((p as unknown as { id: string }).id, p as ToolResult);
  }
  const turn: ToolTurn = parts
    .filter((p) => p.type === 'tool_call')
    .map((p) => {
      const call = p as unknown as ToolCall;
      return { call, result: results.get(call.id) };
    });

  const pieces: MessagePiece<P>[] = [];
  let run: DrawnStep[] | null = null;
  parts.forEach((part, index) => {
    const key = `${messageId}:${index}`;
    if (part.type === 'tool_result') return;
    if (part.type === 'tool_call' && views) {
      const call = part as unknown as ToolCall;
      const result = results.get(call.id);
      const card = views.card?.(call, result, turn);
      if (card) {
        run = null;
        pieces.push({ kind: 'card', key, node: card });
        return;
      }
      const step = views.step?.(call, result);
      if (step) {
        const state =
          result?.isError || step.failed ? 'error' : result ? 'done' : live ? 'running' : 'stopped';
        const drawn: DrawnStep = { ...step, key, state };
        if (run) run.push(drawn);
        else {
          run = [drawn];
          pieces.push({ kind: 'steps', key, steps: run });
        }
        return;
      }
    }
    run = null;
    pieces.push({ kind: 'part', key, part, index });
  });
  return pieces;
}
