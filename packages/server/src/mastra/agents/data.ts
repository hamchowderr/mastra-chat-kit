import type { AgentControllerSubagent } from '@mastra/core/agent-controller';
import { env } from '../../lib/env';
import { doltTools } from '../tools/dolt';

/**
 * # Data Subagent (mastra-chat-kit)
 *
 * Queries and versions the optional Dolt database. Delegated to via the built-in
 * `subagent` tool (`agentType: 'data'`).
 *
 * It is the roster's demonstration of **per-subagent `tools`**: the Dolt tools are
 * registered on the MCP server but deliberately NOT on the chat agent, so nothing in
 * the app could reach them. Attaching them here — rather than to the parent — keeps
 * SQL out of the general assistant's tool list (where it would be one more thing for
 * the model to misfire on) while still making the capability available on demand.
 *
 * Dolt is OPT-IN and off by default. This subagent is only registered when
 * `doltConfigured` is true (see lib/agent-controller.ts); registering it
 * unconditionally would advertise a specialist whose every tool call fails against a
 * database that isn't running.
 */
export const dataSubagent: AgentControllerSubagent = {
  id: 'data',
  name: 'Data',
  description:
    'Data specialist for the versioned Dolt database: runs SQL, writes rows, and reads commit history. Delegate "query / count / insert / what changed in the data" tasks to it. Only available when Dolt is configured.',
  instructions: `You work with a Dolt database — MySQL-compatible SQL with Git-style version history.

Workflow:
- Inspect before you assume: list tables and read a table's shape before querying or writing it. Do not guess column names.
- Prefer one focused query over several broad ones. Select the columns you need, not *.
- After a write, confirm it by reading the affected rows back.
- Use the history tool when asked what changed, who changed it, or how the data looked earlier — that version history is the reason this database is here.

Rules:
- Report the actual rows returned. Never summarize a result set you did not receive.
- If a query errors, show the error and what you will try next; do not silently retry a different question.
- Destructive statements (DROP, TRUNCATE, unfiltered DELETE/UPDATE) need the user's explicit go-ahead — say what you intend to run and wait.`,
  defaultModelId: env.CHAT_MODEL,
  // Attached HERE rather than on the chat agent, which has no Dolt tools on purpose.
  tools: { ...doltTools },
  forked: false,
};
