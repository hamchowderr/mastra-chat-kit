import type { ToolCategory } from '@mastra/core/agent-controller';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { FIRECRAWL_TOOLS } from './firecrawl';

const { FILESYSTEM, SANDBOX, SEARCH, LSP } = WORKSPACE_TOOLS;

/**
 * The Firecrawl browser's tools (lib/firecrawl-browser.ts), by the names
 * `@mastra/agent-browser` registers them under. Plain names, so nothing here loads the
 * provider; tool-categories.test.ts checks them against its real `getTools()`.
 *
 * Reads look at pages and change nothing on them: the `read` category, so they are in
 * Plan mode and an "Always allow" on reads covers them. browser_goto is here (it loads a
 * page, as firecrawl_scrape does) but is not auto-allowed, so opening a new site asks.
 */
export const BROWSER_READ_TOOLS = [
  'browser_goto',
  'browser_back',
  'browser_snapshot',
  'browser_screenshot',
  'browser_scroll',
  'browser_wait',
] as const;

/**
 * Browser tools that run with no approval card: the reads other than browser_goto, and
 * browser_close. They change nothing on a page, but any of them can still start a billed
 * session, or reopen one after the run that had it ended, with no card.
 */
export const BROWSER_AUTO_ALLOWED_TOOLS = [
  'browser_back',
  'browser_snapshot',
  'browser_screenshot',
  'browser_scroll',
  'browser_wait',
  'browser_close',
] as const;

/**
 * Browser tools that act on a page. They have no category, so each call asks and an
 * "Always allow" approves only that call. (browser_evaluate, which runs JavaScript in
 * the page, is not offered at all: the provider is built with `excludeTools`.)
 */
export const BROWSER_ACTION_TOOLS = [
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_select',
  'browser_hover',
  'browser_dialog',
  'browser_drag',
  'browser_tabs',
] as const;

/**
 * Tool id → Mastra `ToolCategory`, for the AgentController's `toolCategoryResolver`.
 *
 * An "Always allow" decision grants the gated tool's CATEGORY for the rest of the
 * session, so every tool here must sit in the category a user would expect to
 * have agreed to. Some tools are deliberately left out, and so resolve to `null`:
 * an always-allow on them then approves just that one call.
 *
 * - `mastra_workspace_delete`: destructive, so it asks every time.
 * - `setGoal`, `start_schedule`, `stop_schedule`, `subagent`: each hands the
 *   agent more autonomy (a standing objective, a recurring background run, a
 *   delegated run). `ToolCategory` is a closed set, so they cannot get a category
 *   of their own, and sharing `other` with `generateImage` would let one
 *   "Always allow" on an image request switch off every one of these gates.
 * - The Firecrawl browser's page actions (BROWSER_ACTION_TOOLS: click, type, press,
 *   select, hover, dialog, drag, tabs): they act on a live site, which no category
 *   describes. `execute` means the
 *   sandbox shell, and an "Always allow" on a click must not also allow shell commands.
 * - Any tool not listed (a new tool, an MCP tool): it must be categorized on
 *   purpose, not picked up by an existing grant.
 */
const CATEGORIES: Record<string, ToolCategory> = {
  // Read: looks things up, changes nothing.
  getWeather: 'read',
  searchKnowledge: 'read',
  list_schedules: 'read',
  doltQuery: 'read',
  doltHistory: 'read',
  // Firecrawl (lib/firecrawl.ts): searches the web and reads pages, changes nothing.
  // Also auto-allowed (AUTO_ALLOWED_TOOLS), so they never show an approval card.
  firecrawl_search: 'read',
  firecrawl_scrape: 'read',
  // The Firecrawl browser: open a page, go back, look at it, scroll, wait. browser_goto
  // still asks before each new site unless reads are always allowed; the others are also
  // auto-allowed.
  ...Object.fromEntries(BROWSER_READ_TOOLS.map((name) => [name, 'read' as const])),
  [FILESYSTEM.READ_FILE]: 'read',
  [FILESYSTEM.LIST_FILES]: 'read',
  [FILESYSTEM.FILE_STAT]: 'read',
  [FILESYSTEM.GREP]: 'read',
  [SEARCH.SEARCH]: 'read',
  [LSP.LSP_INSPECT]: 'read',
  [SANDBOX.GET_PROCESS_OUTPUT]: 'read',

  // Edit: changes files or data, but runs nothing.
  doltWrite: 'edit',
  [FILESYSTEM.WRITE_FILE]: 'edit',
  [FILESYSTEM.EDIT_FILE]: 'edit',
  [FILESYSTEM.AST_EDIT]: 'edit',
  [FILESYSTEM.MKDIR]: 'edit',
  [SEARCH.INDEX]: 'edit',

  // Execute: runs or stops processes in the sandbox.
  [SANDBOX.EXECUTE_COMMAND]: 'execute',
  [SANDBOX.KILL_PROCESS]: 'execute',

  // Other: creates something for the user outside the workspace.
  generateImage: 'other',
};

export function resolveToolCategory(toolName: string): ToolCategory | null {
  return CATEGORIES[toolName] ?? null;
}

/** Every tool name with a category (tests check each is a name the agent really sees). */
export const CATEGORIZED_TOOLS: readonly string[] = Object.keys(CATEGORIES);

/** Every tool in the `read` category: it looks things up and changes nothing. */
export const READ_TOOLS: readonly string[] = Object.keys(CATEGORIES).filter(
  (name) => CATEGORIES[name] === 'read',
);

/**
 * What the agent may use in Plan mode (the mode's `availableTools`, Mastra's per-mode
 * allowlist): the read tools to investigate, the workspace write_file tool for the plan
 * file, and submit_plan. Nothing else is visible or runnable in that mode, so an
 * "Always allow" on edits can't let a Plan turn change anything but its plan file.
 */
export const PLAN_MODE_TOOLS: readonly string[] = [
  ...READ_TOOLS,
  FILESYSTEM.WRITE_FILE,
  'submit_plan',
];

/**
 * Tools the live session runs without an approval gate: the controller's interaction
 * and bookkeeping tools, where a gate would only be a redundant, confusing extra click.
 *  - ask_user — the answer prompt IS the interaction; without this the user would
 *    first approve "Run ask_user?" (showing the question as raw args), THEN the prompt.
 *  - submit_plan — likewise: the plan card's Approve / Reject IS the decision. Gated,
 *    the user would approve "Run submit_plan?" and only then see the plan to approve.
 *  - task_write/update/complete/check — pure progress tracking that drives the <Task>
 *    element; gating them makes the user approve "task_write" before seeing a to-do list.
 *  - list_schedules — read-only view of existing schedules (the schedules panel + the
 *    agent answering "what's scheduled?"). Its mutating siblings start_schedule /
 *    stop_schedule stay GATED: creating a recurring background run is a real side effect,
 *    so it flows through the approval gate (an intentional HITL demo).
 *  - firecrawl_search / firecrawl_scrape — web lookups that change nothing. They spend
 *    Firecrawl credits, but the key's owner turned them on by setting the key, and a
 *    card before every search would make web search unusable.
 *  - BROWSER_AUTO_ALLOWED_TOOLS — the Firecrawl browser's look-only tools (snapshot,
 *    screenshot, scroll, wait, back) and browser_close. Opening a new site
 *    (browser_goto) and every page action (click, type, …) stay GATED.
 * Everything with a real side effect (fs writes, shell, browser, subagents, start/stop
 * schedule) stays gated. lib/agent-controller.ts grants these to every session; tests
 * drive a session with the same grants.
 */
export const AUTO_ALLOWED_TOOLS = [
  'ask_user',
  'submit_plan',
  'task_write',
  'task_update',
  'task_complete',
  'task_check',
  'list_schedules',
  ...FIRECRAWL_TOOLS,
  ...BROWSER_AUTO_ALLOWED_TOOLS,
] as const;

/**
 * What a forked subagent run may use. A forked subagent is the chat agent itself on a
 * cloned thread, and Mastra runs it with `requireToolApproval: false`, so no approval
 * card can appear inside it. It is offered only what never needs one: the auto-allowed
 * tools, and the reads other than browser_goto (opening a new site asks in the parent).
 * Edits, the shell, deletes, page actions, images, goals, schedules and further
 * subagents are left out (lib/tool-scope.ts applies this).
 */
export const FORKED_RUN_TOOLS: readonly string[] = [
  ...new Set<string>([
    ...AUTO_ALLOWED_TOOLS,
    ...READ_TOOLS.filter((name) => name !== 'browser_goto'),
  ]),
];
