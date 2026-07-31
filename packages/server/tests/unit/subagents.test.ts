import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { describe, expect, it } from 'vitest';
import { codeSubagent } from '../../src/mastra/agents/code';
import { dataSubagent } from '../../src/mastra/agents/data';
import { researchSubagent } from '../../src/mastra/agents/research';
import { reviewerSubagent } from '../../src/mastra/agents/reviewer';
import { writerSubagent } from '../../src/mastra/agents/writer';

/**
 * The specialist subagent roster. Each must be a real `forked:false` specialist (its
 * own instructions/model/tools, not a self-clone) with a unique agentType id and a
 * description — the subagent tool's auto-generated description is built from these, so
 * a dup id or a missing description degrades the parent's ability to route work.
 *
 * Beyond that, two members exist to demonstrate a specific scoping lever, and those
 * levers are what the tests below actually guard: `review` is narrowed with
 * `allowedWorkspaceTools`, `data` brings `tools` the parent doesn't have.
 */
describe('subagent roster', () => {
  const roster = [codeSubagent, researchSubagent, writerSubagent, reviewerSubagent, dataSubagent];

  it('has unique agentType ids', () => {
    const ids = roster.map((s) => s.id);
    expect(ids).toEqual(['code', 'research', 'writer', 'review', 'data']);
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

  // The reviewer's read-only-ness is enforced by the controller from this list, not by
  // its prompt. If someone widens it, a "reviewer" silently gains the ability to
  // rewrite or execute the thing it was asked to audit — so assert the absence, not
  // just the presence.
  it('the reviewer can read the workspace but cannot mutate or execute', () => {
    const allowed = reviewerSubagent.allowedWorkspaceTools ?? [];
    expect(allowed).toContain(WORKSPACE_TOOLS.FILESYSTEM.READ_FILE);
    expect(allowed).toContain(WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES);

    for (const forbidden of [
      WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
      WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
      WORKSPACE_TOOLS.FILESYSTEM.DELETE,
      WORKSPACE_TOOLS.FILESYSTEM.MKDIR,
      WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND,
    ]) {
      expect(allowed).not.toContain(forbidden);
    }
  });

  // Only `review` is restricted; the others intentionally inherit the whole workspace.
  it('no other specialist is workspace-restricted', () => {
    for (const s of [codeSubagent, researchSubagent, writerSubagent, dataSubagent]) {
      expect(s.allowedWorkspaceTools).toBeUndefined();
    }
  });

  // The Dolt tools are deliberately absent from the chat agent, so `data` is the only
  // way anything in the app reaches them.
  it('the data specialist carries the Dolt tools itself', () => {
    const names = Object.keys(dataSubagent.tools ?? {});
    expect(names).toEqual(expect.arrayContaining(['doltQuery', 'doltWrite', 'doltHistory']));
  });
});
