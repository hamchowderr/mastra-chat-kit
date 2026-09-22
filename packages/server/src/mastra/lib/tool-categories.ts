import type { ToolCategory } from '@mastra/core/agent-controller';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';

const { FILESYSTEM, SANDBOX, SEARCH, LSP } = WORKSPACE_TOOLS;

/**
 * Tool id → Mastra `ToolCategory`, for the AgentController's `toolCategoryResolver`.
 *
 * An "Always allow" decision grants the gated tool's CATEGORY for the rest of the
 * session, so every tool here must sit in the category a user would expect to
 * have agreed to. Two tools are deliberately left out, and so resolve to `null`:
 * an always-allow on them then approves just that one call.
 *
 * - `mastra_workspace_delete`: destructive, so it asks every time.
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

  // Other: acts on the user's behalf in some other way.
  generateImage: 'other',
  setGoal: 'other',
  start_schedule: 'other',
  stop_schedule: 'other',
  subagent: 'other',
};

export function resolveToolCategory(toolName: string): ToolCategory | null {
  return CATEGORIES[toolName] ?? null;
}
