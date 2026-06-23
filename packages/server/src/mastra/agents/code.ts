import { Agent } from '@mastra/core/agent';
import { env } from '../../lib/env';
import { createDefaultMemory } from '../lib/memory';
import { getCodeWorkspace } from '../lib/workspace';

/**
 * # Code Agent (mastra-chat-kit)
 *
 * A coding agent that works inside a real Mastra sandbox workspace. Its tools are
 * Mastra's built-in workspace tools (read/write/edit/list files, grep, mkdir,
 * execute_command) bound to a LocalFilesystem + LocalSandbox. Those tool calls
 * are what light up the Code-category AI Elements with REAL data:
 *   - list_files     → <FileTree>
 *   - execute_command→ <Terminal>  (+ <TestResults> on test runs, <StackTrace> on errors)
 *   - read/write/edit→ <CodeBlock>
 *
 * Driven by the same Single Agent transport as `chat` (POST /chat/code). The web
 * "Code Agent" mode points the composer at this agent and renders its workspace
 * tool calls into the Code elements.
 *
 * Tools are a lazy DynamicArgument so the sandbox only spins up on the first run,
 * not at server boot.
 */
export const codeAgent = new Agent({
  id: 'code',
  name: 'Code Agent',
  description:
    'Coding agent that builds and runs code inside a sandboxed Mastra workspace. Exercises the Code AI Elements (File Tree, Terminal, Code Block) with real tool output.',
  instructions: `You are a coding agent working inside a sandboxed workspace with a real filesystem and shell.

Workflow:
- Start by calling list_files to see what's in the workspace.
- Use write_file / edit_file to create or change files. Prefer small, focused files.
- Use execute_command to run code, install dependencies, and run tests — then read the output and fix problems.
- When asked to build something, actually create the files AND run it to prove it works.
- After making changes, briefly summarize what you did and show the key file(s).

Rules:
- Use relative paths from the workspace root (no leading slash).
- Keep commands non-interactive. Don't start long-running servers unless asked.
- Never claim a result you didn't verify by running it.`,
  model: env.CHAT_MODEL,
  // Lazy: resolves (and initializes) the sandbox workspace on first run.
  tools: async () => (await getCodeWorkspace()).tools,
  memory: createDefaultMemory(),
});
