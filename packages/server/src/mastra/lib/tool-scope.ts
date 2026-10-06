import type { ProcessInputStepArgs, Processor } from '@mastra/core/processors';
import { FORKED_RUN_TOOLS, PLAN_MODE_TOOLS } from './tool-categories';

/**
 * # Which tools a controller run is offered
 *
 * An input processor on the chat agent. Its `processInputStep` returns `activeTools`
 * (Mastra's per-step allowlist) before every model step, for two runs the
 * AgentController leaves unrestricted:
 *
 * - **A forked subagent run.** The controller runs a forked subagent as the chat agent
 *   itself, with `requireToolApproval: false` and no allowlist, so every tool it is
 *   offered runs without an approval card. It is limited to FORKED_RUN_TOOLS: nothing
 *   that edits, runs commands, deletes or acts on a web page. Detected from the run's
 *   memory thread, which the controller creates with `metadata.forkedSubagent: true`
 *   (`cloneThreadForFork`).
 * - **A Plan mode run resumed after an approval.** The controller applies the mode's
 *   `availableTools` to a new run, but `resumeToolCall` does not pass it on, so the
 *   resumed steps were offered every tool. The mode comes from the request context's
 *   `controller.session.modeId`, which the controller also sets on a resume.
 *
 * Outside the controller (Studio, the REST/A2A/MCP routes) there is no `controller`
 * context, and it does nothing.
 */
export class ToolScopeProcessor implements Processor<'tool-scope'> {
  readonly id = 'tool-scope';
  readonly description =
    'Limits a forked subagent run to tools that need no approval, and keeps a mode allowlist on resumed runs.';

  constructor(
    /** A mode id's allowlist (the same list as the mode's `availableTools`). */
    private readonly modeTools: Record<string, readonly string[]>,
    private readonly forkedTools: readonly string[] = FORKED_RUN_TOOLS,
  ) {}

  processInputStep({ requestContext, tools, activeTools }: ProcessInputStepArgs) {
    const controller = requestContext?.get('controller') as
      | { session?: { modeId?: string } }
      | undefined;
    if (!controller) return {};
    const memory = requestContext?.get('MastraMemory') as
      | { thread?: { metadata?: Record<string, unknown> } }
      | undefined;
    const forked = memory?.thread?.metadata?.forkedSubagent === true;
    const modeId = controller.session?.modeId;
    const modeAllowlist = modeId ? this.modeTools[modeId] : undefined;
    if (!forked && !modeAllowlist) return {};

    let allowed = activeTools ?? Object.keys(tools ?? {});
    if (modeAllowlist) allowed = allowed.filter((name) => modeAllowlist.includes(name));
    if (forked) allowed = allowed.filter((name) => this.forkedTools.includes(name));
    return { activeTools: allowed };
  }
}

/** The chat agent's tool scope, with Plan mode's allowlist (lib/agent-controller.ts). */
export const toolScopeProcessor = new ToolScopeProcessor({ plan: PLAN_MODE_TOOLS });
