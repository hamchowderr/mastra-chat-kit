import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { describe, expect, it } from 'vitest';
import { resolveToolCategory } from '../../src/mastra/lib/tool-categories';

describe('resolveToolCategory — what "Always allow" grants', () => {
  it('puts lookups in read, file changes in edit, shell in execute', () => {
    expect(resolveToolCategory('getWeather')).toBe('read');
    expect(resolveToolCategory(WORKSPACE_TOOLS.FILESYSTEM.READ_FILE)).toBe('read');
    expect(resolveToolCategory(WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE)).toBe('edit');
    expect(resolveToolCategory(WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND)).toBe('execute');
  });

  it('never lets delete ride on an edit grant', () => {
    expect(resolveToolCategory(WORKSPACE_TOOLS.FILESYSTEM.DELETE)).toBeNull();
  });

  it('keeps goals, schedules and subagents off the image grant', () => {
    expect(resolveToolCategory('generateImage')).toBe('other');
    for (const tool of ['setGoal', 'start_schedule', 'stop_schedule', 'subagent']) {
      expect(resolveToolCategory(tool)).toBeNull();
    }
  });

  it('leaves unknown tools uncategorized, so no existing grant covers them', () => {
    expect(resolveToolCategory('some_new_mcp_tool')).toBeNull();
  });
});
