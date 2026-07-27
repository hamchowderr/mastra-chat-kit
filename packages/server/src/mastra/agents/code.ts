import type { AgentControllerSubagent } from '@mastra/core/agent-controller';
import { env } from '../../lib/env';

/**
 * # Code Subagent (mastra-chat-kit)
 *
 * A coding **subagent** the single harness agent delegates to via the built-in
 * `subagent` tool (`agentType: 'code'`). It is NOT a top-level agent — the kit
 * runs ONE agent, which spawns focused subagents on demand (a fresh instance per
 * `task`). This mirrors the official `template-agent-harness` single-agent design.
 *
 * It inherits the controller's Workspace (LocalFilesystem + LocalSandbox), so its
 * tool calls are the real workspace tools that light up the Code AI Elements with
 * live data:
 *   - list/find files → <FileTree>
 *   - execute_command → <Terminal>  (+ <TestResults> on test runs, <StackTrace> on errors)
 *   - read/write/edit  → <CodeBlock>
 *
 * It runs `forked: false` — a TRUE specialist: a fresh agent built from the
 * `instructions` / `defaultModelId` / tools below, spawned per `task`. The parent
 * can still request a `forked` (self-clone) subagent per invocation when a subtask
 * needs the parent's conversation context.
 */
export const codeSubagent: AgentControllerSubagent = {
  id: 'code',
  name: 'Code',
  description:
    'Coding subagent that builds and runs code inside the sandboxed workspace (files + shell). Delegate substantial multi-step build/run/fix tasks to it.',
  instructions: `You are a coding subagent working inside a sandboxed workspace with a real filesystem and shell.

Workflow:
- Start by listing the workspace to see what's there.
- Use the write/edit file tools to create or change files. Prefer small, focused files.
- Use execute_command to run code, install dependencies, and run tests — then read the output and fix problems.
- When asked to build something, actually create the files AND run it to prove it works.
- After making changes, briefly summarize what you did and show the key file(s).

Rules:
- Use relative paths from the workspace root (no leading slash).
- Keep commands non-interactive. Don't start long-running servers unless asked.
- Never claim a result you didn't verify by running it.`,
  defaultModelId: env.CHAT_MODEL,
  // Workspace tools are inherited from the controller's Workspace. Left unrestricted
  // (all fs + shell tools visible); tighten via `allowedWorkspaceTools` if needed.
  //
  // forked: false → a real specialist. It runs with THIS definition's instructions /
  // model / tools (not a clone of the parent), which is the whole point of a code
  // subagent. The parent hands it a self-contained task; a non-forked run doesn't see
  // the parent conversation, so the `subagent` tool is instructed to include full
  // context in the task.
  //
  // HISTORY (`mastra-chat-kit-698.32`, resolved): an earlier @mastra/core hard-threw
  // `[Processor:browser-context] computeStateSignal requires Mastra memory with an
  // active resourceId and threadId` for a non-forked subagent when the workspace
  // carried a browser (the controller runs non-forked stateless — threadId:null,
  // resourceId:"" — yet built it with the browser-bearing workspace). We ran it
  // forked as a workaround. On the CURRENT core it no longer reproduces — verified
  // with the browser both unlaunched AND launched — so we run the real specialist.
  // Guarded by tests/integration/subagent-browser-repro.test.ts (flips red if a core
  // upgrade regresses it). See docs/harness-events.md.
  forked: false,
};
