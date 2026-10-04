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
 */

/** A narrow assistant: plan files only, the writer, nothing else. */
const NARROW: ChatFeatures = resolveFeatures({
  workspaceMode: 'plans',
  sandbox: true,
  browser: true,
  subagents: { code: false, research: false, writer: true, review: false, data: false },
  generateImage: false,
  demoTools: false,
});

describe('feature switches — defaults', () => {
  it('the env defaults are the full kit', async () => {
    const { features } = await import('../../src/mastra/lib/features');
    expect(features).toEqual(FULL_FEATURES);
  });

  it('the full kit keeps every tool and specialist', () => {
    expect(Object.keys(chatTools(FULL_FEATURES))).toEqual(
      expect.arrayContaining(['getWeather', 'searchKnowledge', 'generateImage', 'setGoal']),
    );
    expect(Object.keys(chatTools(FULL_FEATURES))).not.toContain('write_plan');
    expect(chatSubagents(FULL_FEATURES, true).map((s) => s.id)).toEqual([
      'code',
      'research',
      'writer',
      'review',
      'data',
    ]);
  });

  it('data still needs Dolt', () => {
    expect(chatSubagents(FULL_FEATURES, false).map((s) => s.id)).not.toContain('data');
  });
});

describe('feature switches — a narrow assistant', () => {
  it('plans mode forces the sandbox and browser off', () => {
    expect(NARROW.sandbox).toBe(false);
    expect(NARROW.browser).toBe(false);
  });

  it('drops the demo tools and image generation, and adds write_plan', () => {
    const tools = Object.keys(chatTools(NARROW));
    expect(tools).not.toContain('getWeather');
    expect(tools).not.toContain('searchKnowledge');
    expect(tools).not.toContain('generateImage');
    expect(tools).toContain('write_plan');
  });

  it('keeps only the switched-on specialists', () => {
    expect(chatSubagents(NARROW, true).map((s) => s.id)).toEqual(['writer']);
  });

  it('research loses searchKnowledge when the demo tools are off', () => {
    const f = { ...NARROW, subagents: { ...NARROW.subagents, research: true } };
    const research = chatSubagents(f, false).find((s) => s.id === 'research');
    expect(Object.keys(research?.tools ?? {})).toEqual([]);
  });

  it('never tells the agent about a tool or specialist it does not have', () => {
    const text = chatInstructions(NARROW);
    for (const absent of ['getWeather', 'searchKnowledge', 'generateImage', '"code"', '"review"']) {
      expect(text).not.toContain(absent);
    }
    expect(text).toContain('"writer"');
    expect(text).toContain('write_plan');
    expect(planModeInstructions(NARROW)).toContain('write_plan');
  });

  it('the plans workspace has a filesystem only, with every tool hidden', () => {
    const ws = createChatWorkspace({ root: tmpdir(), features: NARROW });
    expect(ws.filesystem).toBeDefined();
    expect(ws.sandbox).toBeUndefined();
    expect(ws.browser).toBeUndefined();
  });

  it('a full workspace can drop just the sandbox', () => {
    const ws = createChatWorkspace({
      root: tmpdir(),
      features: { ...FULL_FEATURES, sandbox: false },
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
