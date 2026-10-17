import type { Session } from '@mastra/core/agent-controller';

export type SuspensionCancelledEvent = {
  type: 'tool_suspension_cancelled';
  toolCallId: string;
  toolName: string;
  reason: string;
};

/**
 * A new message dismisses any ask_user question still waiting for an answer
 * (mastra-chat-kit-dpi). Call it before the new message is sent.
 *
 * A suspending tool ends its run, so the suspension stays parked on the Session
 * after the stream closes. `session.abort()` is core's way to abandon parked
 * suspensions: it drops them and their display-state mirror. After that,
 * `respondToToolSuspension` finds nothing to resume and returns, so answering the
 * stale card cannot resume the old run.
 *
 * `abort()` emits no per-tool event, so this returns one
 * `tool_suspension_cancelled` per dropped suspension for the route to send the
 * client. That event clears the matching card in the web reducer.
 */
export function dismissParkedSuspensions(session: Session): SuspensionCancelledEvent[] {
  const parked = [...session.displayState.get().pendingSuspensions.values()];
  if (parked.length === 0 && !session.suspensions.hasPending()) {
    return [];
  }
  session.abort();
  return parked.map(({ toolCallId, toolName }) => ({
    type: 'tool_suspension_cancelled',
    toolCallId,
    toolName,
    reason: 'dismissed by a new message',
  }));
}
