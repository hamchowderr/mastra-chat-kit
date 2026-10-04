import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatInstructions, chatTools } from '../../src/mastra/agents/chat';
import {
  AUTO_ALLOWED_TOOLS,
  chatSubagents,
  planModeInstructions,
} from '../../src/mastra/lib/agent-controller';
import { type ChatFeatures, FULL_FEATURES, resolveFeatures } from '../../src/mastra/lib/features';
import { resolveToolCategory } from '../../src/mastra/lib/tool-categories';
import { createChatWorkspace } from '../../src/mastra/lib/workspace';
import { planDirFor } from '../../src/mastra/routes/resource';
import { createWritePlanTool, newPlanFileName, planSlug } from '../../src/mastra/tools/plan';
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
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'plans-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const write = (resourceId: string, input: Record<string, unknown>) =>
    callTool<{ path: string }>(createWritePlanTool(root), input, { agent: { resourceId } });

  it("writes into the user's own folder, under a name that can't collide", async () => {
    const a = await write('alice', { title: 'Grant application', plan: '1. Read the call' });
    const b = await write('bob', { title: 'Grant application', plan: '1. Draft the budget' });
    const a2 = await write('alice', { title: 'Grant application', plan: '1. Another' });
    expect(path.posix.dirname(a.path)).toBe(planDirFor('alice'));
    expect(path.posix.dirname(b.path)).toBe(planDirFor('bob'));
    expect(new Set([a.path, b.path, a2.path]).size).toBe(3);
    expect(await readFile(path.join(root, a.path), 'utf8')).toContain('1. Read the call');
    expect(await readFile(path.join(root, b.path), 'utf8')).toContain('1. Draft the budget');
  });

  it('revises the same file when given back its path', async () => {
    const first = await write('alice', { title: 'Budget', plan: '1. Old' });
    const again = await write('alice', { title: 'Budget', plan: '1. New', path: first.path });
    expect(again.path).toBe(first.path);
    expect(await readFile(path.join(root, first.path), 'utf8')).toContain('1. New');
  });

  it("won't revise a file outside the user's folder", async () => {
    const bobs = await write('bob', { title: 'Secret', plan: '1. Bob only' });
    const out = await write('alice', { title: 'Secret', plan: '1. Alice', path: bobs.path });
    expect(out.path).not.toBe(bobs.path);
    expect(await readFile(path.join(root, bobs.path), 'utf8')).toContain('1. Bob only');
    const escaped = await write('alice', {
      title: 'Escape',
      plan: '1. x',
      path: `${planDirFor('alice')}/../../etc.md`,
    });
    expect(path.posix.dirname(escaped.path)).toBe(planDirFor('alice'));
  });

  it('names non-Latin titles safely, still unique', () => {
    expect(planSlug('../../etc/passwd')).toBe('etc-passwd');
    expect(newPlanFileName('助成金の申請', 'abcd1234')).toBe('plan-abcd1234.md');
    expect(newPlanFileName('助成金の申請')).not.toBe(newPlanFileName('助成金の申請'));
  });

  it('runs without an approval card and sits in the edit category', () => {
    expect(AUTO_ALLOWED_TOOLS).toContain('write_plan');
    expect(resolveToolCategory('write_plan')).toBe('edit');
  });
});
