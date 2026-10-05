import type { ToolCategory } from '@mastra/core/agent-controller';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';

const { FILESYSTEM, SANDBOX, SEARCH, LSP } = WORKSPACE_TOOLS;

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
