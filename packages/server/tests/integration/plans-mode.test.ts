import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemoryStore } from '@mastra/core/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUTO_ALLOWED_TOOLS,
  createChatAgentController,
} from '../../src/mastra/lib/agent-controller';
import { type ChatFeatures, resolveFeatures } from '../../src/mastra/lib/features';

/**
 * WORKSPACE_MODE=plans through the real AgentController, on AIMock. Every workspace tool
 * is hidden, yet Plan mode still works end to end: the agent writes its plan with
 * write_plan (no approval card), submit_plan suspends on that file, and approving it
 * resumes the run. The file is on disk where the Plan card reads it.
 */

const NARROW: ChatFeatures = resolveFeatures({
  workspaceMode: 'plans',
  sandbox: false,
  browser: false,
  subagents: { code: false, research: false, writer: true, review: false, data: false },
  generateImage: false,
  demoTools: false,
});

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'plans-mode-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('plans workspace mode (AIMock)', () => {
  it('writes the plan with write_plan, submits it, and resumes on approval', async () => {
    const controller = createChatAgentController({
      storage: new InMemoryStore(),
      resourceId: 'u-plans',
      browser: null,
      features: NARROW,
      root,
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-plans' });
    for (const tool of AUTO_ALLOWED_TOOLS) session.grantTool(tool);

    // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide; we assert on .type
    const events: any[] = [];
    const unsubscribe = session.subscribe((e) => {
      events.push(e);
    });
    await session.thread.create({ title: 'plans' });
    await session.sendMessage({ content: 'Plan a grant application, then wait for my approval.' });

    // write_plan ran with no card; submit_plan parked the run on the plan file.
    expect(events.some((e) => e.type === 'tool_approval_required')).toBe(false);
    const suspended = events.find(
      (e) => e.type === 'tool_suspended' && e.toolName === 'submit_plan',
    );
    expect(suspended).toBeDefined();
    expect(JSON.stringify(suspended)).toContain('plans/grant-application.md');
    expect(existsSync(path.join(root, 'plans/grant-application.md'))).toBe(true);

    await session.respondToToolSuspension({ resumeData: { action: 'approved' } });
    unsubscribe();
    await controller.destroy();

    expect(JSON.stringify(events)).toContain('The plan is approved');
  });

  it('offers the agent no workspace file or shell tools', async () => {
    const controller = createChatAgentController({
      storage: new InMemoryStore(),
      browser: null,
      features: NARROW,
      root,
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-plans-tools' });
    const agent = controller.getCurrentAgent(session);
    const tools = Object.keys(await agent.listTools());
    await controller.destroy();

    expect(tools).toContain('write_plan');
    expect(tools.some((t) => t.startsWith('mastra_workspace_'))).toBe(false);
    expect(tools).not.toContain('getWeather');
    expect(tools).not.toContain('generateImage');
  });
});
