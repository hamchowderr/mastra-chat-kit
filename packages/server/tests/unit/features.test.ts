import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { chatInstructions, chatTools } from '../../src/mastra/agents/chat';
import { chatSubagents, PLAN_MODE_INSTRUCTIONS } from '../../src/mastra/lib/agent-controller';
import { type ChatFeatures, FULL_FEATURES, resolveFeatures } from '../../src/mastra/lib/features';
import { createChatWorkspace } from '../../src/mastra/lib/workspace';

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

describe('feature switches — a narrow assistant', () => {
  const narrow = resolveFeatures(
    {
      sandbox: false,
      browser: false,
      subagents: { code: true, research: true, writer: true, review: false, data: true },
      generateImage: false,
      demoTools: false,
    },
    { dolt: false },
  );

  it('keeps only what can work without a sandbox, browser or Dolt (review switched off): the writer', () => {
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

describe('plan mode', () => {
  // Mastra's submit_plan takes the PATH of a plan file the agent wrote, so both the chat
  // instructions and Plan mode's own say to write it with the workspace write_file tool.
  it('writes the plan with write_file and submits its path', () => {
    for (const text of [PLAN_MODE_INSTRUCTIONS, chatInstructions(FULL_FEATURES)]) {
      expect(text).toContain('write_file');
      expect(text).toContain('submit_plan');
      expect(text).toContain('plans/');
    }
  });

  it('the workspace keeps its file tools with the sandbox and browser off', () => {
    const ws = createChatWorkspace({
      root: tmpdir(),
      features: resolveFeatures(
        { ...FULL_FEATURES, sandbox: false, browser: false },
        { dolt: false },
      ),
    });
    expect(ws.filesystem).toBeDefined();
    expect(ws.sandbox).toBeUndefined();
    expect(ws.browser).toBeUndefined();
  });
});
