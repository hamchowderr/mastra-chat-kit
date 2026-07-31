import { describe, expect, it } from 'vitest';
import { codeSubagent } from '../../src/mastra/agents/code';
import { researchSubagent } from '../../src/mastra/agents/research';
import { writerSubagent } from '../../src/mastra/agents/writer';

/**
 * The specialist subagent roster: code / research / writer. Each must be a real
 * `forked:false` specialist (its own instructions/model/tools, not a self-clone) with a
 * unique agentType id and a description (the subagent tool's auto-generated description
 * lists these). Guards against a dup id or someone flipping a specialist back to forked.
 */
describe('subagent roster', () => {
  const roster = [codeSubagent, researchSubagent, writerSubagent];

  it('has three specialists with unique agentType ids', () => {
    const ids = roster.map((s) => s.id);
    expect(ids).toEqual(['code', 'research', 'writer']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each is a real specialist (forked:false) with instructions + description + a model', () => {
    for (const s of roster) {
      expect(s.forked).toBe(false); // a real specialist, not a parent clone
      expect(typeof s.description).toBe('string');
      expect((s.description as string).length).toBeGreaterThan(10);
      expect(s.instructions).toBeTruthy();
      expect(s.defaultModelId).toBeTruthy();
    }
  });
});
