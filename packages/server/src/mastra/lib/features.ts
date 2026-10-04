import { env } from '../../lib/env';

/**
 * # What the agent can do
 *
 * One object that says which parts of the kit are switched on, read once from env.
 * Every switch defaults to the full kit, so a server with none of these set behaves
 * exactly as before. The workspace, the subagent roster, the chat agent's tools and its
 * instructions all read this, and each takes it as an argument so tests can build any
 * combination without reloading env.
 *
 * `workspaceMode: 'plans'` is the narrow option for an assistant that should never
 * touch files or run commands: a filesystem that holds only plan files, no sandbox, no
 * browser, every workspace tool hidden, and `write_plan` so Plan mode still works (the
 * built-in `submit_plan` takes a file path, and the Plan card reads that file).
 */
export type WorkspaceMode = 'full' | 'plans';

export type ChatFeatures = {
  workspaceMode: WorkspaceMode;
  /** Shell sandbox (execute_command). Always off in `plans` mode. */
  sandbox: boolean;
  /** Headless browser + the Browser panel. Always off in `plans` mode. */
  browser: boolean;
  subagents: {
    code: boolean;
    research: boolean;
    writer: boolean;
    review: boolean;
    /** Also needs Dolt configured. */
    data: boolean;
  };
  generateImage: boolean;
  /** getWeather + searchKnowledge, the deterministic demo tools. */
  demoTools: boolean;
};

export const FULL_FEATURES: ChatFeatures = {
  workspaceMode: 'full',
  sandbox: true,
  browser: true,
  subagents: { code: true, research: true, writer: true, review: true, data: true },
  generateImage: true,
  demoTools: true,
};

/** Resolve the switches, applying what `plans` mode implies. */
export function resolveFeatures(input: ChatFeatures): ChatFeatures {
  const plans = input.workspaceMode === 'plans';
  return {
    ...input,
    sandbox: plans ? false : input.sandbox,
    browser: plans ? false : input.browser,
    subagents: { ...input.subagents },
  };
}

export const features: ChatFeatures = resolveFeatures({
  workspaceMode: env.WORKSPACE_MODE,
  sandbox: env.WORKSPACE_SANDBOX,
  browser: env.WORKSPACE_BROWSER,
  subagents: {
    code: env.SUBAGENT_CODE,
    research: env.SUBAGENT_RESEARCH,
    writer: env.SUBAGENT_WRITER,
    review: env.SUBAGENT_REVIEW,
    data: env.SUBAGENT_DATA,
  },
  generateImage: env.TOOL_GENERATE_IMAGE,
  demoTools: env.TOOL_DEMO,
});
