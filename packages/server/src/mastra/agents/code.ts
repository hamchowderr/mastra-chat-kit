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
 * `forked: true` is REQUIRED in production today (see the field note below). The
 * parent can still request a forked (self-clone) subagent per invocation.
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
  // forked: true is REQUIRED in production. Root cause (traced in core 1.52,
  // empirically confirmed: `browser:null` works, a real browser throws): the
  // controller runs a non-forked subagent STATELESS (`threadId:null`, `resourceId:""`,
  // no `memory` on `.stream()`) but builds it as `new Agent({workspace})`, so the
  // browser on the workspace auto-attaches the `browser-context` state-signal
  // processor, whose `computeStateSignal` HARD-THROWS unless the run has memory + an
  // active resourceId/threadId. Forked clones the parent thread, so it has all three;
  // a non-forked run has none and fails. TRADE-OFF: forked
  // ignores the `instructions`/`tools`/`defaultModelId` above and runs as a clone of
  // the parent agent — so this is currently a self-clone worker, not a code
  // specialist. No clean kit-level fix (removing the browser breaks the main agent;
  // the subagent config exposes no memory/thread/browser lever) — it's an upstream core
  // bug (the state-signal processor should skip, not throw, on a threadless run).
  // Tracked in `mastra-chat-kit-698.32`. See docs/harness-events.md.
  forked: true,
};
