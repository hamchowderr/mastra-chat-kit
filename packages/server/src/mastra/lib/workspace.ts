/**
 * # Shared Workspace (filesystem + sandbox + browser)
 *
 * ONE workspace instance for the whole server, used by BOTH:
 *   - the chat Agent (`chatAgent.workspace`) — so Mastra Studio surfaces the workspace
 *     + its tools on the registered agent, matching the official template-agent-harness
 *     (698.31), and
 *   - the AgentController harness (`createChatHarness`) — the session that drives our
 *     custom UI.
 *
 * Sharing ONE instance (rather than constructing one per surface) is what "no double
 * provision" means: the filesystem/sandbox/browser initialize once, and the browser it
 * carries is the SAME Chrome the `/browser/screencast` route streams.
 *
 * The per-tool approval policy (698.21) lives here so both surfaces inherit it: write/
 * edit require a prior read of the file (`requireReadBeforeWrite`), delete requires
 * explicit approval (`requireApproval`). NOTE: under the AgentController every tool is
 * ALSO gated by the controller's global approval (HITL) — these declarative controls are
 * what protects a workspace used OUTSIDE the controller (e.g. Studio), and encode intent.
 *
 * This module deliberately imports neither the agent nor the harness, so both can import
 * it without a cycle.
 */

import path from 'node:path';
import { BrowserViewer } from '@mastra/browser-viewer';
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace';
import { env } from '../../lib/env';

// Absolute root for the agent's workspace (filesystem + sandbox share it). Under
// `mastra dev` the cwd shifts, so resolve a relative WORKSPACE_ROOT once here.
// Exported so the /workspace/* routes can read the same folder the agent works in.
export const WORKSPACE_ROOT = path.isAbsolute(env.WORKSPACE_ROOT)
  ? env.WORKSPACE_ROOT
  : path.resolve(process.cwd(), env.WORKSPACE_ROOT);

/**
 * Build the workspace's browser: a `BrowserViewer` (a `MastraBrowser`) that owns a
 * Playwright-driven Chrome and injects its CDP URL into the CLI the agent shells out to
 * (`agent-browser` by default), so shell-driven and native browser tools drive the SAME
 * window. Construction is cheap — Chrome launches lazily on first use, so this stays off
 * the boot/AIMock/test path until a browser tool actually fires.
 */
export function createBrowser(): BrowserViewer {
  return new BrowserViewer({
    cli: env.BROWSER_CLI,
    headless: env.BROWSER_HEADLESS,
    ...(env.BROWSER_EXECUTABLE_PATH ? { executablePath: env.BROWSER_EXECUTABLE_PATH } : {}),
  });
}

let browserSingleton: BrowserViewer | null = null;
/** The process-wide browser the live workspace uses (exposed for the screencast route). */
export function getChatBrowserInstance(): BrowserViewer {
  if (!browserSingleton) {
    browserSingleton = createBrowser();
  }
  return browserSingleton;
}

let workspaceSingleton: Workspace | null = null;
/**
 * The process-wide shared workspace. Lazily constructed; the browser launches lazily on
 * first use, so importing this stays cheap. Tests never call this — they build their own
 * throwaway workspace via `createChatHarness` and gate the agent's workspace off (env
 * `AGENT_WORKSPACE=false`), keeping runs hermetic.
 */
export function getChatWorkspace(): Workspace {
  if (!workspaceSingleton) {
    workspaceSingleton = new Workspace({
      id: 'chat-workspace',
      filesystem: new LocalFilesystem({ basePath: WORKSPACE_ROOT }),
      sandbox: new LocalSandbox({ workingDirectory: WORKSPACE_ROOT }),
      browser: getChatBrowserInstance(),
      // Per-tool safety policy (698.21). requireReadBeforeWrite forces the agent to read
      // a file before overwriting/editing it; delete always needs explicit approval.
      tools: {
        [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { requireReadBeforeWrite: true },
        [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: { requireReadBeforeWrite: true },
        [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { requireApproval: true },
      },
    });
  }
  return workspaceSingleton;
}
