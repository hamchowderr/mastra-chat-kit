import { describe, expect, it } from 'vitest';
import {
  collectToolResults,
  emptyTranscript,
  type HarnessMessage,
  reduceHarnessEvent,
  reduceHarnessEvents,
} from '@/lib/harness/events';

// The reducer is the testable core of the Agent Harness transport — folding the
// SSE HarnessEvents into the transcript the view renders, with no network/React.
describe('harness reducer', () => {
  it('captures threadId from the __thread__ sentinel', () => {
    const s = reduceHarnessEvent(emptyTranscript(), { type: '__thread__', threadId: 't1' });
    expect(s.threadId).toBe('t1');
  });

  it('upserts messages by id (later update replaces content)', () => {
    const events = [
      {
        type: 'message_start',
        message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Hel' }] },
      },
      {
        type: 'message_update',
        message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
      },
    ];
    const s = reduceHarnessEvents(emptyTranscript(), events);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].content[0]).toMatchObject({ text: 'Hello!' });
  });

  it('records tasks, pending approval, and error', () => {
    const s = reduceHarnessEvents(emptyTranscript(), [
      { type: 'task_updated', tasks: [{ id: 'a', content: 'do x', status: 'pending' }] },
      {
        type: 'tool_approval_required',
        toolCallId: 'c1',
        toolName: 'deleteFile',
        args: { path: 'x' },
      },
      { type: 'error', error: 'boom' },
    ]);
    expect(s.tasks).toHaveLength(1);
    expect(s.pendingApproval?.toolName).toBe('deleteFile');
    expect(s.error).toBe('boom');
  });

  it('clears pending approval once the gate resolves', () => {
    const armed = reduceHarnessEvent(emptyTranscript(), {
      type: 'tool_approval_required',
      toolCallId: 'c1',
      toolName: 'deleteFile',
      args: {},
    });
    expect(armed.pendingApproval).not.toBeNull();
    // approve → tool runs → tool_end clears the gate
    expect(
      reduceHarnessEvent(armed, { type: 'tool_end', toolCallId: 'c1' }).pendingApproval,
    ).toBeNull();
    // a finished run also clears it (and marks done)
    const finished = reduceHarnessEvent(armed, { type: '__done__' });
    expect(finished.pendingApproval).toBeNull();
    expect(finished.done).toBe(true);
  });

  it('accumulates shell_output into the terminal buffer and toggles running', () => {
    const streaming = reduceHarnessEvents(emptyTranscript(), [
      { type: 'shell_output', toolCallId: 'c1', output: 'line 1\n', stream: 'stdout' },
      { type: 'shell_output', toolCallId: 'c1', output: 'line 2\n', stream: 'stderr' },
    ]);
    expect(streaming.terminal.output).toBe('line 1\nline 2\n');
    expect(streaming.terminal.running).toBe(true);
    // the command settling drops the streaming caret but keeps the scrollback
    const settled = reduceHarnessEvent(streaming, { type: 'tool_end', toolCallId: 'c1' });
    expect(settled.terminal.running).toBe(false);
    expect(settled.terminal.output).toBe('line 1\nline 2\n');
  });

  it('maps the v4-nested tool-invocation shape to a paired tool_call + tool_result', () => {
    // The exact shape Mastra core ≥1.52 emits on message_end (captured from the
    // real AIMock stream): a `tool-invocation` part with data under `toolInvocation`.
    const s = reduceHarnessEvent(emptyTranscript(), {
      type: 'message_end',
      message: {
        id: 'm1',
        role: 'assistant',
        content: {
          format: 2,
          parts: [
            {
              type: 'tool-invocation',
              toolInvocation: {
                state: 'result',
                toolCallId: 'call_K7',
                toolName: 'getWeather',
                args: { location: 'Los Angeles' },
                result: { location: 'Los Angeles', temperatureC: 27, condition: 'Rainy' },
                isError: false,
              },
            },
            { type: 'text', text: 'The weather in Los Angeles looks clear right now.' },
          ],
        },
      },
    });
    const parts = s.messages[0].content;
    const call = parts.find((p) => p.type === 'tool_call') as
      | { name: string; id: string; args: { location: string } }
      | undefined;
    const result = parts.find((p) => p.type === 'tool_result') as
      | { name: string; id: string; result: { temperatureC: number } }
      | undefined;
    // NOT the "invocation" bug — real tool name, args, and a paired result by id.
    expect(call).toMatchObject({
      name: 'getWeather',
      id: 'call_K7',
      args: { location: 'Los Angeles' },
    });
    expect(result).toMatchObject({ name: 'getWeather', id: 'call_K7' });
    expect(result?.result.temperatureC).toBe(27);
    // collectToolResults pairs the result to the call by id (what the view uses).
    expect(collectToolResults(s.messages).get('call_K7')).toMatchObject({ type: 'tool_result' });
  });

  it('maps a still-running tool-invocation (no result yet) to a bare tool_call', () => {
    const s = reduceHarnessEvent(emptyTranscript(), {
      type: 'message_update',
      message: {
        id: 'm1',
        role: 'assistant',
        content: {
          format: 2,
          parts: [
            {
              type: 'tool-invocation',
              toolInvocation: {
                state: 'call',
                toolCallId: 'call_K7',
                toolName: 'getWeather',
                args: { location: 'LA' },
              },
            },
          ],
        },
      },
    });
    expect(s.messages[0].content).toHaveLength(1);
    expect(s.messages[0].content[0]).toMatchObject({ type: 'tool_call', name: 'getWeather' });
  });

  it('folds workspace lifecycle into the status snapshot', () => {
    const ready = reduceHarnessEvent(emptyTranscript(), {
      type: 'workspace_ready',
      workspaceId: 'w1',
      workspaceName: 'chat-workspace',
    });
    expect(ready.workspace).toMatchObject({ status: 'ready', name: 'chat-workspace' });
    // a later status transition replaces the snapshot
    const pending = reduceHarnessEvent(ready, {
      type: 'workspace_status_changed',
      status: 'pending',
    });
    expect(pending.workspace).toMatchObject({ status: 'pending' });
    // an error carries its message
    const failed = reduceHarnessEvent(pending, { type: 'workspace_error', error: 'sandbox down' });
    expect(failed.workspace).toMatchObject({ status: 'error', error: 'sandbox down' });
  });

  it('folds a full subagent lifecycle into one run, keyed by toolCallId', () => {
    const s = reduceHarnessEvents(emptyTranscript(), [
      {
        type: 'subagent_start',
        toolCallId: 'sa1',
        agentType: 'code',
        task: 'write hello.js',
        modelId: 'anthropic/claude-sonnet-4-6',
        forked: false,
      },
      { type: 'subagent_text_delta', toolCallId: 'sa1', textDelta: 'Creating ' },
      { type: 'subagent_text_delta', toolCallId: 'sa1', textDelta: 'the file.' },
      {
        type: 'subagent_tool_start',
        toolCallId: 'sa1',
        subToolName: 'write_file',
        subToolArgs: { path: 'hello.js' },
      },
      {
        type: 'subagent_tool_end',
        toolCallId: 'sa1',
        subToolName: 'write_file',
        subToolResult: { ok: true },
        isError: false,
      },
      { type: 'subagent_end', toolCallId: 'sa1', result: 'done', isError: false, durationMs: 1234 },
    ]);
    expect(s.subagents).toHaveLength(1);
    const run = s.subagents[0];
    expect(run).toMatchObject({
      toolCallId: 'sa1',
      agentType: 'code',
      task: 'write hello.js',
      text: 'Creating the file.',
      status: 'done',
      durationMs: 1234,
    });
    expect(run.tools).toHaveLength(1);
    expect(run.tools[0]).toMatchObject({
      name: 'write_file',
      result: { ok: true },
      isError: false,
    });
  });

  it('creates a subagent stub if a delta arrives before start (out-of-order safe)', () => {
    const s = reduceHarnessEvent(emptyTranscript(), {
      type: 'subagent_text_delta',
      toolCallId: 'sa9',
      textDelta: 'hi',
    });
    expect(s.subagents[0]).toMatchObject({ toolCallId: 'sa9', text: 'hi', status: 'running' });
  });

  it('reflects the active mode from mode_changed', () => {
    const s = reduceHarnessEvent(emptyTranscript(), {
      type: 'mode_changed',
      modeId: 'plan',
      previousModeId: 'chat',
    });
    expect(s.activeMode).toBe('plan');
  });

  it('folds goal_evaluation into the goal card (objective, iteration, verdict)', () => {
    // First evaluation: not passed yet, one iteration of three.
    const first = reduceHarnessEvent(emptyTranscript(), {
      type: 'goal_evaluation',
      payload: {
        objective: 'Create hello.txt and prove it exists.',
        iteration: 1,
        maxRuns: 3,
        passed: false,
        status: 'active',
        reason: 'File not created yet — write it and verify.',
      },
    });
    expect(first.goal).toMatchObject({
      objective: 'Create hello.txt and prove it exists.',
      iteration: 1,
      maxRuns: 3,
      passed: false,
      status: 'active',
    });
    // A later evaluation replaces the verdict (passed → done) on the same goal.
    const done = reduceHarnessEvent(first, {
      type: 'goal_evaluation',
      payload: {
        objective: 'Create hello.txt and prove it exists.',
        iteration: 2,
        maxRuns: 3,
        passed: true,
        status: 'done',
      },
    });
    expect(done.goal).toMatchObject({ iteration: 2, passed: true, status: 'done' });
  });

  it('records the latest info status line', () => {
    const s = reduceHarnessEvents(emptyTranscript(), [
      { type: 'info', message: 'starting up' },
      { type: 'info', message: 'thinking…' },
    ]);
    expect(s.info).toBe('thinking…');
  });

  it('passes unknown events through untouched', () => {
    const before = emptyTranscript();
    const after = reduceHarnessEvent(before, { type: 'om_status', windows: {} });
    expect(after).toEqual(before);
  });

  it('pairs tool results to calls by id', () => {
    const messages: HarnessMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: [
          { type: 'tool_call', id: 'tc1', name: 'getWeather', args: { location: 'LA' } },
          { type: 'tool_result', id: 'tc1', name: 'getWeather', result: { temperatureC: 22 } },
        ],
      },
    ];
    const map = collectToolResults(messages);
    expect(map.get('tc1')).toMatchObject({ type: 'tool_result' });
  });
});
