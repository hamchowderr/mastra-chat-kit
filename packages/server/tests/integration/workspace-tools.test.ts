import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent } from '@mastra/core/agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/lib/env';
import { createChatWorkspace } from '../../src/mastra/lib/workspace';

/**
 * The workspace tools doing real work in a temp folder, under the kit's REAL
 * workspace policy (createChatWorkspace, the function the live app uses).
 *
 * Driven through a plain Agent that carries that workspace. Under NODE_ENV=test the
 * chat agent's own workspace is off, and the AgentController does not hand the
 * main agent workspace tools, so a controller run gets ToolNotFoundError.
 * AIMock fixtures ("Workspace test: …" in fixtures/chat.json) make the model call
 * each tool; the assertions check what really happened on disk and in the shell.
 */

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'chat-kit-ws-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function agentOn(dir: string) {
  return new Agent({
    id: 'workspace-test',
    name: 'Workspace test',
    instructions: 'Use the workspace tools to do what the user asks.',
    model: env.CHAT_MODEL,
    workspace: createChatWorkspace({ root: dir }),
  });
}

describe('workspace tools under the real policy', () => {
  it('writes a new file into the workspace folder', async () => {
    await agentOn(root).generate('Workspace test: write notes.txt');

    expect(readFileSync(path.join(root, 'notes.txt'), 'utf8')).toBe('hello from the agent');
  });

  it('runs a shell command in the workspace and returns its output', async () => {
    const result = await agentOn(root).generate('Workspace test: run a command');

    // The command prints 6*7; "42" is nowhere in its arguments, only in real output.
    expect(JSON.stringify(result.toolResults)).toContain('42');
  });

  it('refuses to overwrite a file the agent has not read first', async () => {
    writeFileSync(path.join(root, 'notes.txt'), 'original');
    const result = await agentOn(root).generate('Workspace test: overwrite notes.txt');

    expect(readFileSync(path.join(root, 'notes.txt'), 'utf8')).toBe('original');
    // Refused, not skipped: the tool ran and said why. The refusal is a text tool
    // result inside the step, not an entry in toolResults.
    expect(JSON.stringify(result.steps)).toContain('You must read a file before writing to it');
  });

  it('pauses for approval before deleting, and deletes nothing meanwhile', async () => {
    writeFileSync(path.join(root, 'notes.txt'), 'keep me');
    const result = await agentOn(root).generate('Workspace test: delete notes.txt');

    expect(result.finishReason).toBe('suspended');
    expect(existsSync(path.join(root, 'notes.txt'))).toBe(true);
  });
});
