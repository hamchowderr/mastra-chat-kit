import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWorkspaceTools,
  LocalFilesystem,
  LocalSandbox,
  Workspace,
} from '@mastra/core/workspace';

/**
 * Lazily-built singleton workspace for the Code Agent.
 *
 * A Mastra {@link Workspace} pairs a {@link LocalFilesystem} (a real folder on
 * disk) with a {@link LocalSandbox} for executing commands. On this host
 * `getRecommendedIsolation()` is `'none'` (no seatbelt/bwrap on Windows), so we
 * run with `isolation: 'none'` — commands execute directly via execa. That's
 * fine for a local reference kit; swap in a cloud sandbox (e2b, ComputeSDK) for
 * untrusted multi-tenant use.
 *
 * `createWorkspaceTools(workspace)` returns the agent tools (read/write/edit/list
 * files, grep, mkdir, execute_command, …) already bound to this workspace — those
 * tool calls are what drive the Code-category AI Elements (File Tree, Terminal,
 * Code Block) with real data.
 */
// biome-ignore lint/suspicious/noExplicitAny: createWorkspaceTools returns Record<string, any>
let cache: Promise<{ workspace: Workspace; tools: Record<string, any> }> | null = null;

async function build() {
  const basePath = mkdtempSync(join(tmpdir(), 'mastra-chat-kit-ws-'));
  const workspace = new Workspace({
    filesystem: new LocalFilesystem({ basePath }),
    sandbox: new LocalSandbox({ isolation: 'none' }),
  });
  await workspace.init();
  // Seed a README so the workspace isn't empty on the first list_files.
  await workspace.filesystem?.writeFile(
    'README.md',
    '# Sandbox workspace\n\nThe Code Agent builds and runs code here.\n',
    { recursive: true },
  );
  const tools = await createWorkspaceTools(workspace);
  return { workspace, tools };
}

/** Resolves the shared workspace + its agent tools, initializing on first use. */
export function getCodeWorkspace() {
  if (!cache) {
    cache = build();
  }
  return cache;
}
