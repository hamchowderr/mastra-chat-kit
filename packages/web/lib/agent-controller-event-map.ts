/**
 * Source of truth for the /events page: every one of the 50 `AgentControllerEvent`
 * types the controller emits, whether this kit's reducer consumes it today, which AI
 * Element (or other surface) it drives, and — where a user can trigger it — a
 * copy-paste prompt that makes it happen live in the chat.
 *
 * Grounded in the INSTALLED core declaration (`@mastra/core/dist/agent-controller/
 * types.d.ts`, the `AgentControllerEvent` union) and re-derived from the actual
 * `reduceAgentControllerEvent` cases in `lib/agent-controller/events.ts` — keep it in lockstep with both,
 * and with `docs/agent-controller-events.md`. "Consumed" means a real case folds it into the
 * transcript today; "dropped" means it hits `default: return state` (on the wire but
 * unrendered — not necessarily a bug; see each row's note).
 */

/**
 * Base URL for linking an element to its source file. Empty during local-only dev
 * (the /events page then shows the path as a plain chip). Set it to the repo's blob
 * base once a remote exists — e.g. 'https://github.com/<owner>/mastra-chat-kit/blob/main'
 * — and every `‹source›` link lights up automatically.
 */
export const SOURCE_BASE = '';

/** Where the vendored AI Elements live in the repo (for the `‹source›` link path). */
export const AI_ELEMENTS_DIR = 'packages/web/components/ai-elements';

/** Full source URL for an element module, or null when no remote is configured yet. */
export function elementSourceUrl(moduleName: string): string | null {
  return SOURCE_BASE ? `${SOURCE_BASE}/${AI_ELEMENTS_DIR}/${moduleName}.tsx` : null;
}

export type EventGroup =
  | 'Run lifecycle'
  | 'Session & modes'
  | 'Threads'
  | 'Messages'
  | 'Tools & HITL'
  | 'Workspace'
  | 'Observational memory'
  | 'Subagents'
  | 'Tasks & goals';

export const GROUP_ORDER: EventGroup[] = [
  'Run lifecycle',
  'Session & modes',
  'Threads',
  'Messages',
  'Tools & HITL',
  'Workspace',
  'Observational memory',
  'Subagents',
  'Tasks & goals',
];

export interface AgentControllerEventRow {
  /** Position in the core union (matches docs/agent-controller-events.md). */
  n: number;
  type: string;
  meaning: string;
  /** True when `reduceAgentControllerEvent` folds it into the transcript today. */
  consumed: boolean;
  group: EventGroup;
  /**
   * The AI Element module (in components/ai-elements) this event drives, when it drives a
   * showcased element — powers the `‹source›` link.
   */
  element?: string;
  /** Display name of the target element. */
  elementLabel?: string;
  /** Plain target label when the surface is NOT an AI Element (status dot, sidebar, panel). */
  target?: string;
  /**
   * A copy-paste prompt that triggers this event live in the chat (AgentController mode). Present
   * on events a user turn can produce; automatic / UI-action events (e.g. agent_start,
   * model_changed) omit it. Clustered events (all of Tools/Subagents/OM) share one prompt.
   */
  prompt?: string;
  /** One line: which issue wired it, or why it is (intentionally) dropped. */
  note?: string;
}

const P = {
  weather: 'What is the weather in Tokyo?',
  askUser: 'Deploy my app.',
  message: 'Say hello and tell me a fun fact.',
  subagent:
    'Use the code subagent to create hello.js that prints the numbers 1 to 10, then run it.',
  workspace: 'Use the code subagent to create a file notes.txt with a short note in it.',
  shell: 'Use the code subagent to run `node --version` in the workspace.',
  task: 'Plan and build a tiny counter script in clear, tracked steps.',
  goal: 'Keep refining a haiku about the ocean until it is genuinely excellent — do not stop early.',
  plan: 'Investigate adding a dark-mode toggle and propose a short plan first, before changing anything.',
  om: 'Have a short back-and-forth with me (five or so messages) — once the token window fills, the Observer distills durable facts.',
  followUp: 'Send this, then immediately send another message while I am still replying.',
  anyTurn: 'Send any message — this fires on every run.',
} as const;

/** All 50 events, in core-union order. `element` set ⇒ it links to source; `prompt` set ⇒ copy-paste to trigger. */
export const AGENT_CONTROLLER_EVENTS: AgentControllerEventRow[] = [
  // ── Run lifecycle ──────────────────────────────────────────────────────────
  {
    n: 7,
    type: 'agent_start',
    meaning: 'An agent run began.',
    consumed: false,
    group: 'Run lifecycle',
    element: 'shimmer',
    elementLabel: 'Shimmer',
    note: 'Deferred — redundant with the existing streaming/typing indicator.',
  },
  {
    n: 8,
    type: 'agent_end',
    meaning: 'The run finished (complete / aborted / error / suspended).',
    consumed: true,
    group: 'Run lifecycle',
    target: 'Clears the approval gate, stops the terminal spinner.',
    prompt: P.anyTurn,
  },
  {
    n: 24,
    type: 'error',
    meaning: 'An error occurred during the run.',
    consumed: true,
    group: 'Run lifecycle',
    target: 'Inline error line in the chat.',
  },
  {
    n: 23,
    type: 'info',
    meaning: 'A transient informational status message.',
    consumed: true,
    group: 'Run lifecycle',
    target: 'Info status line.',
  },
  {
    n: 22,
    type: 'usage_update',
    meaning: 'Cumulative token usage for the turn.',
    consumed: true,
    group: 'Run lifecycle',
    element: 'context',
    elementLabel: 'Context',
    prompt: P.anyTurn,
    note: 'Folds into the Context popover in the composer footer.',
  },
  {
    n: 25,
    type: 'follow_up_queued',
    meaning: 'Messages sent while the run was busy were queued.',
    consumed: true,
    group: 'Run lifecycle',
    element: 'queue',
    elementLabel: 'Queue',
    prompt: P.followUp,
  },

  // ── Session & modes ────────────────────────────────────────────────────────
  {
    n: 1,
    type: 'mode_changed',
    meaning: 'The session switched controller mode (Chat ⇄ Plan).',
    consumed: true,
    group: 'Session & modes',
    target: 'Active-mode state (agent-driven; plan→build transition).',
    prompt: P.plan,
    note: 'Wired in 698.28.',
  },
  {
    n: 2,
    type: 'model_changed',
    meaning: 'The active model changed at some scope.',
    consumed: false,
    group: 'Session & modes',
    element: 'model-selector',
    elementLabel: 'Model Selector',
    note: "Deferred — the composer's own picker already shows the active model. Switch it there.",
  },
  {
    n: 6,
    type: 'state_changed',
    meaning: 'The controller state object mutated.',
    consumed: false,
    group: 'Session & modes',
    target: '— (intentionally off; redundant with the granular events).',
  },
  {
    n: 50,
    type: 'display_state_changed',
    meaning: 'Aggregate canonical display-state snapshot.',
    consumed: false,
    group: 'Session & modes',
    target: '— (intentionally off; its Map fields serialize to {} over JSON).',
  },

  // ── Threads ────────────────────────────────────────────────────────────────
  {
    n: 3,
    type: 'thread_changed',
    meaning: 'The active thread switched.',
    consumed: false,
    group: 'Threads',
    target: 'Conversation sidebar (switch chats in the left rail).',
    note: 'The sidebar refetches on run-settle instead of folding these live.',
  },
  {
    n: 4,
    type: 'thread_created',
    meaning: 'A new thread was created.',
    consumed: false,
    group: 'Threads',
    target: 'Conversation sidebar (start a new chat).',
    note: 'Sidebar refetches on run-settle.',
  },
  {
    n: 5,
    type: 'thread_deleted',
    meaning: 'A thread was deleted.',
    consumed: false,
    group: 'Threads',
    target: 'Conversation sidebar (delete a chat).',
    note: 'Sidebar refetches on run-settle.',
  },

  // ── Messages ───────────────────────────────────────────────────────────────
  {
    n: 9,
    type: 'message_start',
    meaning: 'A message began streaming.',
    consumed: true,
    group: 'Messages',
    element: 'message',
    elementLabel: 'Message',
    prompt: P.message,
  },
  {
    n: 10,
    type: 'message_update',
    meaning: 'A message updated with new parts (text / reasoning / tool).',
    consumed: true,
    group: 'Messages',
    element: 'message',
    elementLabel: 'Message',
    prompt: P.message,
  },
  {
    n: 11,
    type: 'message_end',
    meaning: 'A message reached its final form.',
    consumed: true,
    group: 'Messages',
    element: 'message',
    elementLabel: 'Message',
    prompt: P.message,
  },

  // ── Tools & HITL ───────────────────────────────────────────────────────────
  {
    n: 12,
    type: 'tool_start',
    meaning: 'A tool call started (args fully formed).',
    consumed: true,
    group: 'Tools & HITL',
    element: 'tool',
    elementLabel: 'Tool',
    prompt: P.weather,
    note: 'Wired in 698.25 (live input-streaming state).',
  },
  {
    n: 18,
    type: 'tool_input_start',
    meaning: 'The model began streaming a tool call’s arguments.',
    consumed: true,
    group: 'Tools & HITL',
    element: 'tool',
    elementLabel: 'Tool',
    prompt: P.weather,
    note: 'Wired in 698.25.',
  },
  {
    n: 19,
    type: 'tool_input_delta',
    meaning: 'A chunk of streamed tool-argument text (argsTextDelta).',
    consumed: true,
    group: 'Tools & HITL',
    element: 'tool',
    elementLabel: 'Tool',
    prompt: P.weather,
    note: 'Wired in 698.25 (accumulates into the live ToolInput).',
  },
  {
    n: 20,
    type: 'tool_input_end',
    meaning: 'Tool-argument streaming finished.',
    consumed: true,
    group: 'Tools & HITL',
    element: 'tool',
    elementLabel: 'Tool',
    prompt: P.weather,
    note: 'Wired in 698.25.',
  },
  {
    n: 17,
    type: 'tool_end',
    meaning: 'A tool completed (result / error).',
    consumed: true,
    group: 'Tools & HITL',
    element: 'tool',
    elementLabel: 'Tool',
    prompt: P.weather,
  },
  {
    n: 16,
    type: 'tool_update',
    meaning: 'An incremental (partial) tool result.',
    consumed: false,
    group: 'Tools & HITL',
    element: 'tool',
    elementLabel: 'Tool',
    note: 'Dropped — the settled message-part tool_call already renders the full result.',
  },
  {
    n: 13,
    type: 'tool_approval_required',
    meaning: 'A tool is gated, awaiting approval (HITL).',
    consumed: true,
    group: 'Tools & HITL',
    element: 'confirmation',
    elementLabel: 'Confirmation',
    prompt: P.weather,
    note: 'Approve/decline posts to /agent-controller/approve.',
  },
  {
    n: 14,
    type: 'tool_suspended',
    meaning: 'A tool called suspend() — e.g. the agent-driven ask_user.',
    consumed: true,
    group: 'Tools & HITL',
    target: 'Ask-user prompt (resumes via /agent-controller/answer).',
    prompt: P.askUser,
    note: 'Wired in 698.30 — an ambiguous request makes the agent ask you a question.',
  },
  {
    n: 15,
    type: 'tool_suspension_cancelled',
    meaning: 'A parked suspension was cancelled server-side.',
    consumed: true,
    group: 'Tools & HITL',
    target: 'Clears the ask-user prompt.',
    note: 'Wired in 698.30.',
  },

  // ── Workspace ──────────────────────────────────────────────────────────────
  {
    n: 21,
    type: 'shell_output',
    meaning: 'A sandbox shell stdout/stderr chunk.',
    consumed: true,
    group: 'Workspace',
    element: 'terminal',
    elementLabel: 'Terminal',
    prompt: P.shell,
  },
  {
    n: 26,
    type: 'workspace_status_changed',
    meaning: 'Workspace lifecycle status (pending … destroyed).',
    consumed: true,
    group: 'Workspace',
    target: 'Workbench status dot.',
    prompt: P.workspace,
  },
  {
    n: 27,
    type: 'workspace_ready',
    meaning: 'The workspace initialized (filesystem / sandbox / browser).',
    consumed: true,
    group: 'Workspace',
    target: 'Workbench status dot.',
    prompt: P.workspace,
  },
  {
    n: 28,
    type: 'workspace_error',
    meaning: 'The workspace failed to initialize.',
    consumed: true,
    group: 'Workspace',
    target: 'Workbench status dot.',
  },

  // ── Observational memory (Memory panel) ──────────────────────────────────────
  {
    n: 29,
    type: 'om_status',
    meaning: 'Observational-Memory token-window snapshot (fires each run).',
    consumed: true,
    group: 'Observational memory',
    target: 'Memory panel (token windows).',
    prompt: P.om,
    note: 'Wired in 698.35.',
  },
  {
    n: 30,
    type: 'om_observation_start',
    meaning: 'The Observer began distilling facts from the conversation.',
    consumed: true,
    group: 'Observational memory',
    target: 'Memory panel (activity log).',
    prompt: P.om,
    note: 'Wired in 698.35.',
  },
  {
    n: 31,
    type: 'om_observation_end',
    meaning: 'The Observer finished distilling.',
    consumed: true,
    group: 'Observational memory',
    target: 'Memory panel (activity log).',
    prompt: P.om,
    note: 'Wired in 698.35.',
  },
  {
    n: 32,
    type: 'om_observation_failed',
    meaning: 'An observation cycle failed.',
    consumed: true,
    group: 'Observational memory',
    target: 'Memory panel (activity log).',
    note: 'Wired in 698.35.',
  },
  {
    n: 33,
    type: 'om_reflection_start',
    meaning: 'The Reflector began compressing observations.',
    consumed: true,
    group: 'Observational memory',
    target: 'Memory panel (activity log).',
    prompt: P.om,
    note: 'Wired in 698.35.',
  },
  {
    n: 34,
    type: 'om_reflection_end',
    meaning: 'The Reflector finished compressing.',
    consumed: true,
    group: 'Observational memory',
    target: 'Memory panel (activity log).',
    prompt: P.om,
    note: 'Wired in 698.35.',
  },
  {
    n: 35,
    type: 'om_reflection_failed',
    meaning: 'A reflection cycle failed.',
    consumed: true,
    group: 'Observational memory',
    target: 'Memory panel (activity log).',
    note: 'Wired in 698.35.',
  },
  {
    n: 40,
    type: 'om_activation',
    meaning: 'Buffered observations were activated into context.',
    consumed: true,
    group: 'Observational memory',
    target: 'Memory panel (activity log).',
    prompt: P.om,
    note: 'Wired in 698.35.',
  },
  {
    n: 36,
    type: 'om_model_changed',
    meaning: 'The Observer/Reflector backing model changed.',
    consumed: false,
    group: 'Observational memory',
    target: 'Memory panel.',
    note: 'Fires, but not folded — the panel tracks status + observe/reflect/activate only.',
  },
  {
    n: 37,
    type: 'om_buffering_start',
    meaning: 'OM began buffering observations.',
    consumed: false,
    group: 'Observational memory',
    target: 'Memory panel.',
    note: 'The buffering phase isn’t surfaced (status + activity are).',
  },
  {
    n: 38,
    type: 'om_buffering_end',
    meaning: 'OM finished buffering.',
    consumed: false,
    group: 'Observational memory',
    target: 'Memory panel.',
    note: 'Buffering phase not surfaced.',
  },
  {
    n: 39,
    type: 'om_buffering_failed',
    meaning: 'An OM buffering cycle failed.',
    consumed: false,
    group: 'Observational memory',
    target: 'Memory panel.',
    note: 'Buffering phase not surfaced.',
  },
  {
    n: 41,
    type: 'om_thread_title_updated',
    meaning: 'OM auto-titled the thread.',
    consumed: false,
    group: 'Observational memory',
    target: 'Conversation sidebar.',
    note: 'Not reflected live; titles come from the manual /threads/:id/title route (698.11).',
  },

  // ── Subagents (Agent element) ────────────────────────────────────────────────
  {
    n: 42,
    type: 'subagent_start',
    meaning: 'A subagent was spawned (agentType, task, model, forked?).',
    consumed: true,
    group: 'Subagents',
    element: 'agent',
    elementLabel: 'Agent',
    prompt: P.subagent,
    note: 'Wired in 698.27; the code subagent is a real specialist (698.32).',
  },
  {
    n: 43,
    type: 'subagent_text_delta',
    meaning: 'Streamed assistant text from a subagent.',
    consumed: true,
    group: 'Subagents',
    element: 'agent',
    elementLabel: 'Agent',
    prompt: P.subagent,
  },
  {
    n: 44,
    type: 'subagent_tool_start',
    meaning: 'A subagent tool call started.',
    consumed: true,
    group: 'Subagents',
    element: 'agent',
    elementLabel: 'Agent (nested Tool)',
    prompt: P.subagent,
  },
  {
    n: 45,
    type: 'subagent_tool_end',
    meaning: 'A subagent tool call finished.',
    consumed: true,
    group: 'Subagents',
    element: 'agent',
    elementLabel: 'Agent (nested Tool)',
    prompt: P.subagent,
  },
  {
    n: 46,
    type: 'subagent_end',
    meaning: 'The subagent finished (result / error / duration).',
    consumed: true,
    group: 'Subagents',
    element: 'agent',
    elementLabel: 'Agent',
    prompt: P.subagent,
  },
  {
    n: 47,
    type: 'subagent_model_changed',
    meaning: 'The subagent’s model changed.',
    consumed: true,
    group: 'Subagents',
    element: 'agent',
    elementLabel: 'Agent (header)',
  },

  // ── Tasks & goals ────────────────────────────────────────────────────────────
  {
    n: 48,
    type: 'task_updated',
    meaning: 'The structured task list was replaced.',
    consumed: true,
    group: 'Tasks & goals',
    element: 'task',
    elementLabel: 'Task',
    prompt: P.task,
    note: 'Wired in 698.19 (TaskSignalProvider).',
  },
  {
    n: 49,
    type: 'goal_evaluation',
    meaning: 'The judge scored the standing objective after a turn.',
    consumed: true,
    group: 'Tasks & goals',
    target: 'Goal card.',
    prompt: P.goal,
    note: 'Wired in 698.29 (agent-driven setGoal).',
  },
];

/** Tally for the /events summary header. */
export function eventCounts(): { total: number; consumed: number; dropped: number } {
  const consumed = AGENT_CONTROLLER_EVENTS.filter((e) => e.consumed).length;
  return {
    total: AGENT_CONTROLLER_EVENTS.length,
    consumed,
    dropped: AGENT_CONTROLLER_EVENTS.length - consumed,
  };
}
