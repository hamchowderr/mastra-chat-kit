import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatInstructions, chatTools } from '../../src/mastra/agents/chat';
import {
  AUTO_ALLOWED_TOOLS,
  chatSubagents,
  planModeInstructions,
} from '../../src/mastra/lib/agent-controller';
import { type ChatFeatures, FULL_FEATURES, resolveFeatures } from '../../src/mastra/lib/features';
import { resolveToolCategory } from '../../src/mastra/lib/tool-categories';
import { createChatWorkspace } from '../../src/mastra/lib/workspace';
import { createWritePlanTool, planFileName } from '../../src/mastra/tools/plan';
import { callTool } from '../helpers/call-tool';

/**
 * The feature switches (lib/features.ts). Defaults are the full kit, so these pin both
 * halves: nothing changes for a server with no switches set, and each switch removes
 * exactly its piece — from the tools, the roster, the workspace AND the instructions.
 * A specialist is only offered when what it works with is there.
 */

const ids = (f: ChatFeatures) => chatSubagents(f).map((s) => s.id);

describe('feature switches — defaults', () => {
  it('the env defaults are the full kit (data needs Dolt, which tests do not run)', async () => {
    const { features } = await import('../../src/mastra/lib/features');
    expect(features).toEqual(resolveFeatures(FULL_FEATURES, { dolt: false }));
  });

  it('the full kit keeps every tool and specialist', () => {
    const f = resolveFeatures(FULL_FEATURES, { dolt: true });
    expect(Object.keys(chatTools(f))).toEqual(
      expect.arrayContaining(['getWeather', 'searchKnowledge', 'generateImage', 'setGoal']),
    );
    expect(Object.keys(chatTools(f))).not.toContain('write_plan');
    expect(ids(f)).toEqual(['code', 'research', 'writer', 'review', 'data']);
  });

  it('data needs Dolt', () => {
    expect(ids(resolveFeatures(FULL_FEATURES, { dolt: false }))).not.toContain('data');
  });

  it('code needs the sandbox, research needs the browser', () => {
    const noSandbox = resolveFeatures({ ...FULL_FEATURES, sandbox: false }, { dolt: false });
    expect(ids(noSandbox)).not.toContain('code');
    expect(ids(noSandbox)).toContain('research');
    const noBrowser = resolveFeatures({ ...FULL_FEATURES, browser: false }, { dolt: false });
    expect(ids(noBrowser)).not.toContain('research');
    expect(ids(noBrowser)).toContain('code');
  });
});

describe('feature switches — plans mode on the defaults', () => {
  // Only WORKSPACE_MODE changed: every other switch is still at its default.
  const plans = resolveFeatures({ ...FULL_FEATURES, workspaceMode: 'plans' }, { dolt: false });

  it('turns the sandbox, browser and file tools off, and with them code, research, review', () => {
    expect(plans.sandbox).toBe(false);
    expect(plans.browser).toBe(false);
    expect(ids(plans)).toEqual(['writer']);
  });

  it('tells the agent only about what it has', () => {
    const text = chatInstructions(plans);
    expect(text).not.toContain('"code"');
    expect(text).not.toContain('"research"');
    expect(text).not.toContain('"data"');
    expect(text).not.toContain('"review"');
    expect(text).toContain('"writer"');
    expect(text).toContain('write_plan');
    expect(planModeInstructions(plans)).toContain('write_plan');
  });

  it('adds write_plan to the tools', () => {
    expect(Object.keys(chatTools(plans))).toContain('write_plan');
  });

  it('the workspace has a filesystem only', () => {
    const ws = createChatWorkspace({ root: tmpdir(), features: plans });
    expect(ws.filesystem).toBeDefined();
    expect(ws.sandbox).toBeUndefined();
    expect(ws.browser).toBeUndefined();
  });
});

describe('feature switches — a narrow assistant', () => {
  const narrow = resolveFeatures(
    {
      workspaceMode: 'plans',
      sandbox: true,
      browser: true,
      subagents: { code: true, research: true, writer: true, review: false, data: true },
      generateImage: false,
      demoTools: false,
    },
    { dolt: false },
  );

  it('keeps only what can work without a sandbox, browser, file tools or Dolt: the writer', () => {
    expect(ids(narrow)).toEqual(['writer']);
  });

  it('drops the demo tools and image generation', () => {
    const tools = Object.keys(chatTools(narrow));
    for (const absent of ['getWeather', 'searchKnowledge', 'generateImage']) {
      expect(tools).not.toContain(absent);
    }
    const text = chatInstructions(narrow);
    for (const absent of ['getWeather', 'searchKnowledge', 'generateImage']) {
      expect(text).not.toContain(absent);
    }
  });

  it('research loses searchKnowledge when the demo tools are off', () => {
    const f = resolveFeatures({ ...FULL_FEATURES, demoTools: false }, { dolt: false });
    const research = chatSubagents(f).find((s) => s.id === 'research');
    expect(Object.keys(research?.tools ?? {})).toEqual([]);
  });

  it('a full workspace can drop just the sandbox', () => {
    const ws = createChatWorkspace({
      root: tmpdir(),
      features: resolveFeatures({ ...FULL_FEATURES, sandbox: false }, { dolt: false }),
    });
    expect(ws.filesystem).toBeDefined();
    expect(ws.sandbox).toBeUndefined();
  });
});

describe('write_plan', () => {
  it('writes a Markdown plan under plans/ and returns its path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'plans-'));
    try {
      const out = await callTool<{ path: string }>(createWritePlanTool(root), {
        title: 'Grant application',
        plan: '1. Read the call\n2. Draft the budget',
      });
      expect(out.path).toBe('plans/grant-application.md');
      const text = await readFile(path.join(root, out.path), 'utf8');
      expect(text).toContain('# Grant application');
      expect(text).toContain('2. Draft the budget');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cannot write outside plans/, whatever the title', () => {
    expect(planFileName('../../etc/passwd')).toBe('etc-passwd.md');
    expect(planFileName('!!!')).toBe('plan.md');
  });

  it('runs without an approval card and sits in the edit category', () => {
    expect(AUTO_ALLOWED_TOOLS).toContain('write_plan');
    expect(resolveToolCategory('write_plan')).toBe('edit');
  });
});
