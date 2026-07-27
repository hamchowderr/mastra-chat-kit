/**
 * Single source of truth for the /status page: every one of the 48 installed
 * AI Elements and how it is actually driven in this reference kit.
 *
 * This is the in-product, honest version of docs/coverage.md. The rule is: a
 * status reflects whether a *real conversational turn* (Single Agent or Agent
 * Harness) produces the element's data — not merely whether the component renders.
 *
 *   live      — driven by a real agent turn / real chat interaction.
 *   dormant   — wired into a chat view, but the reference emits no data for it yet.
 *   ui-util   — a working UI utility, not agent output; not mounted in the chat.
 *   showroom  — renders in /showcase only; needs a different surface (a code agent,
 *               a voice pipeline, a workflow-viz canvas, or a live sandbox).
 *
 * Keep this in lockstep with docs/coverage.md and packages/web/app/showcase/page.tsx.
 */

export type WireStatus = 'live' | 'dormant' | 'ui-util' | 'showroom';

export type Surface = 'single' | 'harness' | 'code' | 'showroom';

export type Category = 'Chatbot' | 'Code' | 'Voice' | 'Workflow' | 'Utilities';

export interface WiredElement {
  /** Human label (matches the Showroom card where there is one). */
  name: string;
  /** The ai-elements module file (without .tsx) — proves we cover all 48. */
  module: string;
  category: Category;
  status: WireStatus;
  /** Where the element actually renders with intent. */
  surfaces: Surface[];
  /** One line: what produces (or would produce) its data. */
  driver: string;
}

export const STATUS_META: Record<
  WireStatus,
  { label: string; blurb: string; dot: string; chip: string }
> = {
  live: {
    label: 'Live',
    blurb: 'Driven by a real agent turn in the chat.',
    dot: 'bg-green-500',
    chip: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
  },
  dormant: {
    label: 'Dormant',
    blurb: 'Wired into a chat view, but the reference emits no data for it yet.',
    dot: 'bg-amber-500',
    chip: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  'ui-util': {
    label: 'UI utility',
    blurb: 'A working UI feature, not agent output; not mounted in the chat.',
    dot: 'bg-sky-500',
    chip: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  },
  showroom: {
    label: 'Showroom only',
    blurb: 'Renders in /showcase only — needs a code/voice/workflow surface or sandbox.',
    dot: 'bg-muted-foreground/50',
    chip: 'border-border bg-muted text-muted-foreground',
  },
};

export const SURFACE_LABEL: Record<Surface, string> = {
  single: 'Single Agent',
  harness: 'Agent Harness',
  code: 'Code Agent',
  showroom: 'Showroom',
};

export const CATEGORY_ORDER: Category[] = ['Chatbot', 'Code', 'Voice', 'Workflow', 'Utilities'];

export const ELEMENTS: WiredElement[] = [
  // ---------------------------------------------------------------- Chatbot
  {
    name: 'Conversation',
    module: 'conversation',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'harness', 'showroom'],
    driver:
      'Wraps every chat turn (scroll, empty state). The download-export action is showroom-only.',
  },
  {
    name: 'Message + Response',
    module: 'message',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'harness', 'showroom'],
    driver:
      'Every user/assistant turn (Streamdown markdown). The branching variant is showroom-only.',
  },
  {
    name: 'Reasoning',
    module: 'reasoning',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'harness'],
    driver: 'Anthropic extended thinking → reasoning parts (chatRoute sendReasoning).',
  },
  {
    name: 'Tool',
    module: 'tool',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'harness'],
    driver: 'getWeather / searchKnowledge / generateImage calls, all 7 lifecycle states.',
  },
  {
    name: 'Confirmation',
    module: 'confirmation',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['harness'],
    driver: 'The Harness gates each tool → approve/deny posts to /harness/approve.',
  },
  {
    name: 'Sources',
    module: 'sources',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'harness'],
    driver: 'searchKnowledge results mapped to Source rows in tool-views.',
  },
  {
    name: 'Inline Citation',
    module: 'inline-citation',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'harness'],
    driver: 'searchKnowledge results → inline ref + hover-card source carousel.',
  },
  {
    name: 'Image',
    module: 'image',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'harness'],
    driver: 'generateImage tool → tiny imageId → bytes served from /images/:id.',
  },
  {
    name: 'Task',
    module: 'task',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['harness'],
    driver: 'Harness task_write tool → task_updated events fold into the transcript.',
  },
  {
    name: 'Suggestion',
    module: 'suggestion',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single'],
    driver: 'Empty-state prompt starters in the Single Agent view.',
  },
  {
    name: 'Prompt Input',
    module: 'prompt-input',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'harness'],
    driver: 'The shared <Composer>: attachments, action menu, web-search, model picker, submit.',
  },
  {
    name: 'Shimmer',
    module: 'shimmer',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'harness'],
    driver: "Shows while status is 'submitted' / 'streaming' in both chat views.",
  },
  {
    name: 'Context',
    module: 'context',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'code'],
    driver: 'Real finish-step token usage attached to message.metadata by the /chat route.',
  },
  {
    name: 'Queue',
    module: 'queue',
    category: 'Chatbot',
    status: 'live',
    surfaces: ['single', 'code'],
    driver:
      'Client-side send queue: submit while a run is streaming → enqueued, auto-sent on idle.',
  },
  {
    name: 'Open In Chat',
    module: 'open-in-chat',
    category: 'Chatbot',
    status: 'ui-util',
    surfaces: ['showroom'],
    driver: 'Share-this-conversation-to-another-assistant button; not produced by a turn.',
  },

  // ---------------------------------------------------------------- Code
  {
    name: 'Code Block',
    module: 'code-block',
    category: 'Code',
    status: 'live',
    surfaces: ['code', 'showroom'],
    driver:
      'Code Agent read/write/edit file → Code Block (responses also highlight code via Streamdown).',
  },
  {
    name: 'Snippet',
    module: 'snippet',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Single-line copyable command; needs a code/devtools surface.',
  },
  {
    name: 'Agent',
    module: 'agent',
    category: 'Code',
    status: 'live',
    surfaces: ['harness', 'showroom'],
    driver:
      'Subagent delegation (subagent_* events) → the nested Agent card (SubagentCard): task, streamed text, nested tool calls, result. The code subagent is a real specialist (698.27/698.32).',
  },
  {
    name: 'Artifact',
    module: 'artifact',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Document/code artifact panel; needs an artifact-producing agent.',
  },
  {
    name: 'File Tree',
    module: 'file-tree',
    category: 'Code',
    status: 'live',
    surfaces: ['code', 'showroom'],
    driver: 'Code Agent list_files tree output → parsed into the File Tree.',
  },
  {
    name: 'Terminal',
    module: 'terminal',
    category: 'Code',
    status: 'live',
    surfaces: ['code', 'showroom'],
    driver: 'Code Agent execute_command (real sandbox) stdout/stderr → Terminal.',
  },
  {
    name: 'Sandbox',
    module: 'sandbox',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Live code sandbox (preview/code tabs); a separate app surface.',
  },
  {
    name: 'Commit',
    module: 'commit',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Git commit + file-change view; needs a VCS-aware agent.',
  },
  {
    name: 'Environment Variables',
    module: 'environment-variables',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Masked env list with reveal; a devtools surface.',
  },
  {
    name: 'Package Info',
    module: 'package-info',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Dependency-upgrade summary; a devtools surface.',
  },
  {
    name: 'JSX Preview',
    module: 'jsx-preview',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Renders model-authored JSX; needs a code-gen surface.',
  },
  {
    name: 'Schema Display',
    module: 'schema-display',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'API endpoint schema; needs an API-describing agent.',
  },
  {
    name: 'Stack Trace',
    module: 'stack-trace',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Parsed error with clickable frames; needs a debugging surface.',
  },
  {
    name: 'Test Results',
    module: 'test-results',
    category: 'Code',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Suite pass/fail summary; needs a test-runner surface.',
  },
  {
    name: 'Web Preview',
    module: 'web-preview',
    category: 'Code',
    status: 'live',
    surfaces: ['single'],
    driver: 'Iframes the top web-search source URL (Search toggle on); editable URL bar.',
  },

  // ---------------------------------------------------------------- Voice
  {
    name: 'Audio Player',
    module: 'audio-player',
    category: 'Voice',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Speech playback (media-chrome); needs a voice/TTS pipeline.',
  },
  {
    name: 'Mic Selector',
    module: 'mic-selector',
    category: 'Voice',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Input-device picker (MediaDevices); a voice pipeline.',
  },
  {
    name: 'Speech Input',
    module: 'speech-input',
    category: 'Voice',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Push-to-talk transcription button; a voice pipeline.',
  },
  {
    name: 'Transcription',
    module: 'transcription',
    category: 'Voice',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Time-aligned segments; an STT pipeline.',
  },
  {
    name: 'Voice Selector',
    module: 'voice-selector',
    category: 'Voice',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'TTS voice picker; a voice pipeline.',
  },
  {
    name: 'Persona',
    module: 'persona',
    category: 'Voice',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'Animated voice avatar (Rive WebGL2); a voice pipeline.',
  },

  // ---------------------------------------------------------------- Workflow
  {
    name: 'Chain of Thought',
    module: 'chain-of-thought',
    category: 'Workflow',
    status: 'live',
    surfaces: ['harness'],
    driver: "Built from the agent's real tool-call sequence (StepTrace).",
  },
  {
    name: 'Plan',
    module: 'plan',
    category: 'Workflow',
    status: 'live',
    surfaces: ['harness'],
    driver: 'Harness submit_plan tool → { title, plan } → the Plan card.',
  },
  {
    name: 'Checkpoint',
    module: 'checkpoint',
    category: 'Workflow',
    status: 'ui-util',
    surfaces: ['showroom'],
    driver: 'Thread-snapshot restore; the Harness has checkpoints but they are not wired.',
  },
  {
    name: 'Canvas',
    module: 'canvas',
    category: 'Workflow',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'ReactFlow workflow graph; needs a workflow-viz surface.',
  },
  {
    name: 'Node',
    module: 'node',
    category: 'Workflow',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'ReactFlow node (part of Canvas).',
  },
  {
    name: 'Edge',
    module: 'edge',
    category: 'Workflow',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'ReactFlow edge (part of Canvas).',
  },
  {
    name: 'Connection',
    module: 'connection',
    category: 'Workflow',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'ReactFlow connection line (part of Canvas).',
  },
  {
    name: 'Controls',
    module: 'controls',
    category: 'Workflow',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'ReactFlow zoom/pan controls (part of Canvas).',
  },
  {
    name: 'Panel',
    module: 'panel',
    category: 'Workflow',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'ReactFlow overlay panel (part of Canvas).',
  },
  {
    name: 'Toolbar',
    module: 'toolbar',
    category: 'Workflow',
    status: 'showroom',
    surfaces: ['showroom'],
    driver: 'ReactFlow node toolbar (part of Canvas).',
  },

  // ---------------------------------------------------------------- Utilities
  {
    name: 'Attachments',
    module: 'attachments',
    category: 'Utilities',
    status: 'live',
    surfaces: ['single', 'harness'],
    driver: 'File/image chips in the Composer (server consumption pending, beads mhr).',
  },
  {
    name: 'Model Selector',
    module: 'model-selector',
    category: 'Utilities',
    status: 'live',
    surfaces: ['single', 'harness', 'code'],
    driver:
      'The Composer model picker; selection sent as body.model and honored by the /chat route.',
  },
];

/** Tally of how many modules sit in each status (for the summary header). */
export function statusCounts(): Record<WireStatus, number> {
  const counts: Record<WireStatus, number> = {
    live: 0,
    dormant: 0,
    'ui-util': 0,
    showroom: 0,
  };
  for (const el of ELEMENTS) {
    counts[el.status]++;
  }
  return counts;
}
