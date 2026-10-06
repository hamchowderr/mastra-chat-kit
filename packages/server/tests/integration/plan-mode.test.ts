import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentController } from '@mastra/core/agent-controller';
import { InMemoryStore } from '@mastra/core/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Plan mode end to end in the FULL workspace, through the real AgentController on
 * AIMock, the way Mastra's submit_plan works: in Plan mode the agent writes the plan to
 * a Markdown file with the workspace's own write_file tool (an edit, so it waits for the
 * approval card like any write), then calls submit_plan with that path. submit_plan
 * parks the run; approving it resumes the run, and the controller switches back to Chat
 * (the plan mode's `transitionsTo`).
 *
 * Wired like the live app (as demo-fixtures.test.ts is): the shared workspace on the chat
 * agent and the controller, rooted in a temp folder.
 */

let root: string;
let controller: AgentController;
let AUTO_ALLOWED_TOOLS: readonly string[] = [];
let PLAN_MODE_TOOLS: readonly string[] = [];

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'plan-mode-'));
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('WORKSPACE_ROOT', root);
  // Dynamic imports: env.ts reads process.env once, when it first loads.
  const ac = await import('../../src/mastra/lib/agent-controller');
  AUTO_ALLOWED_TOOLS = ac.AUTO_ALLOWED_TOOLS;
  ({ PLAN_MODE_TOOLS } = await import('../../src/mastra/lib/tool-categories'));
  const { getChatWorkspace } = await import('../../src/mastra/lib/workspace');
  controller = ac.createChatAgentController({
    storage: new InMemoryStore(),
    resourceId: 'u-plan',
    workspace: getChatWorkspace(),
  });
  await controller.init();
}, 60_000);

afterAll(async () => {
  await controller?.destroy();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const until = async (check: () => boolean, ms = 30_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('plan mode in the full workspace (AIMock)', () => {
  it('a Plan turn writes the plan file, submits it, and approving switches back to Chat', async () => {
    const session = await controller.createSession({ resourceId: 'u-plan' });
    for (const tool of AUTO_ALLOWED_TOOLS) session.grantTool(tool);

    // The tools each model request offered (AIMock's journal only keeps the text).
    const offered: string[][] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/v1/messages') && typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { tools?: { name: string }[]; system?: unknown };
        // The title generator's request carries no tools; only the agent's turns count.
        if (body.tools?.length) offered.push(body.tools.map((t) => t.name));
      }
      return realFetch(input, init);
    });

    // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide; we assert on .type
    const events: any[] = [];
    const approvals: string[] = [];
    const unsubscribe = session.subscribe((e) => {
      events.push(e);
      // The plan file is a real write, so it asks first; approve it as the user would.
      if (e.type === 'tool_approval_required') {
        approvals.push(e.toolName);
        session.respondToToolApproval({ decision: 'approve' });
      }
    });

    await session.thread.create({ title: 'plan' });
    // The composer's Plan toggle: the turn names its mode and the route switches to it.
    await session.mode.switch({ modeId: 'plan' });
    const run = session.sendMessage({
      content: 'Plan a grant application, then wait for my approval.',
    });
    await until(() => events.some((e) => e.type === 'tool_suspended'));

    // Plan mode's allowlist (availableTools): the model saw the read tools, the plan
    // file's write and submit_plan, and nothing that edits, runs or delegates.
    const planTurn = offered[0];
    expect(planTurn).toEqual(
      expect.arrayContaining([
        'mastra_workspace_write_file',
        'submit_plan',
        'mastra_workspace_read_file',
      ]),
    );
    const hiddenInPlan = [
      'mastra_workspace_edit_file',
      'mastra_workspace_delete',
      'mastra_workspace_execute_command',
      'setGoal',
      'start_schedule',
      'generateImage',
      'subagent',
    ];
    for (const hidden of hiddenInPlan) {
      expect(planTurn).not.toContain(hidden);
    }
    // The step after the write_file approval is a RESUMED run. The controller does not
    // pass the mode's allowlist to a resume, so lib/tool-scope.ts re-applies it from the
    // request context's mode: that step is still limited to Plan mode's tools.
    const resumedPlanStep = offered[1];
    expect(resumedPlanStep).toEqual(expect.arrayContaining(['submit_plan']));
    for (const name of resumedPlanStep ?? []) expect(PLAN_MODE_TOOLS).toContain(name);
    for (const hidden of hiddenInPlan) {
      expect(resumedPlanStep).not.toContain(hidden);
    }

    // The plan went through the workspace's own write tool (after its approval card),
    // then submit_plan parked the run on that file.
    expect(approvals).toEqual(['mastra_workspace_write_file']);
    const suspended = events.find((e) => e.type === 'tool_suspended');
    expect(suspended.toolName).toBe('submit_plan');
    expect(JSON.stringify(suspended)).toContain('plans/grant-application.md');
    const file = path.join(root, 'plans/grant-application.md');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('# Grant application');

    await session.respondToToolSuspension({
      toolCallId: suspended.toolCallId,
      resumeData: { action: 'approved' },
    });
    await run.catch(() => {});
    await until(() => JSON.stringify(events).includes('The plan is approved'));
    unsubscribe();
    spy.mockRestore();

    // Back in Chat the agent has its full toolset again.
    expect(offered.at(-1)).toEqual(
      expect.arrayContaining(['mastra_workspace_edit_file', 'setGoal', 'submit_plan']),
    );

    // Approving the plan switched the session back to Chat.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'mode_changed', modeId: 'chat' }),
    );
    expect(session.mode.get()).toBe('chat');
  });
});
