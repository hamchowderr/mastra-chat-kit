import { describe, expect, it } from 'vitest';
import {
  type AgentControllerMessage,
  collectToolResults,
  emptyTranscript,
  reduceAgentControllerEvent,
  reduceAgentControllerEvents,
} from '@/lib/agent-controller/events';

// The reducer is the testable core of the Agent Controller transport — folding the
// SSE AgentControllerEvents into the transcript the view renders, with no network/React.
describe('controller reducer', () => {
  it('captures threadId from the __thread__ sentinel', () => {
    const s = reduceAgentControllerEvent(emptyTranscript(), { type: '__thread__', threadId: 't1' });
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
    const s = reduceAgentControllerEvents(emptyTranscript(), events);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].content[0]).toMatchObject({ text: 'Hello!' });
  });

  it('records tasks, pending approval, and error', () => {
    const s = reduceAgentControllerEvents(emptyTranscript(), [
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
    const armed = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'tool_approval_required',
      toolCallId: 'c1',
      toolName: 'deleteFile',
      args: {},
    });
    expect(armed.pendingApproval).not.toBeNull();
    // approve → tool runs → tool_end clears the gate
    expect(
      reduceAgentControllerEvent(armed, { type: 'tool_end', toolCallId: 'c1' }).pendingApproval,
    ).toBeNull();
    // a finished run also clears it (and marks done)
    const finished = reduceAgentControllerEvent(armed, { type: '__done__' });
    expect(finished.pendingApproval).toBeNull();
    expect(finished.done).toBe(true);
  });

  it('folds tool_suspended (ask_user) into a pending suspension with question + options', () => {
    const armed = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'tool_suspended',
      toolCallId: 's1',
      toolName: 'ask_user',
      args: {},
      suspendPayload: {
        question: 'Which environment should I deploy to?',
        options: [{ label: 'staging' }, { label: 'production' }],
        selectionMode: 'single_select',
      },
    });
    expect(armed.pendingSuspension).toMatchObject({
      toolCallId: 's1',
      toolName: 'ask_user',
      question: 'Which environment should I deploy to?',
      selectionMode: 'single_select',
    });
    expect(armed.pendingSuspension?.options).toHaveLength(2);
  });

  it('folds a free-text ask_user suspension (no options)', () => {
    const armed = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'tool_suspended',
      toolCallId: 's2',
      toolName: 'ask_user',
      args: {},
      suspendPayload: { question: 'What should I name the file?' },
    });
    expect(armed.pendingSuspension).toMatchObject({ question: 'What should I name the file?' });
    expect(armed.pendingSuspension?.options).toBeUndefined();
  });

  it('ignores a suspend payload with no question (nothing to render)', () => {
    const s = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'tool_suspended',
      toolCallId: 's3',
      toolName: 'request_access',
      args: {},
      suspendPayload: { resource: 'db' },
    });
    expect(s.pendingSuspension).toBeNull();
  });

  it('clears the suspension when its tool resolves (matching tool_end) or the run ends', () => {
    const armed = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'tool_suspended',
      toolCallId: 's1',
      toolName: 'ask_user',
      args: {},
      suspendPayload: { question: 'Which one?' },
    });
    expect(armed.pendingSuspension).not.toBeNull();
    // a tool_end for a DIFFERENT tool leaves the prompt up
    expect(
      reduceAgentControllerEvent(armed, { type: 'tool_end', toolCallId: 'other' })
        .pendingSuspension,
    ).not.toBeNull();
    // the matching tool_end (answer resumed, tool returned) clears it
    expect(
      reduceAgentControllerEvent(armed, { type: 'tool_end', toolCallId: 's1' }).pendingSuspension,
    ).toBeNull();
    // agent_end carries no toolCallId, so a live prompt survives it
    expect(
      reduceAgentControllerEvent(armed, { type: 'agent_end' }).pendingSuspension,
    ).not.toBeNull();
    // a finished run always clears it
    expect(reduceAgentControllerEvent(armed, { type: '__done__' }).pendingSuspension).toBeNull();
  });

  it('drops the suspension when the server cancels it', () => {
    const armed = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'tool_suspended',
      toolCallId: 's1',
      toolName: 'ask_user',
      args: {},
      suspendPayload: { question: 'Which one?' },
    });
    // a cancel for a different id is a no-op…
    expect(
      reduceAgentControllerEvent(armed, {
        type: 'tool_suspension_cancelled',
        toolCallId: 'other',
        toolName: 'ask_user',
        reason: 'x',
      }).pendingSuspension,
    ).not.toBeNull();
    // …the matching cancel clears it
    expect(
      reduceAgentControllerEvent(armed, {
        type: 'tool_suspension_cancelled',
        toolCallId: 's1',
        toolName: 'ask_user',
        reason: 'run failed',
      }).pendingSuspension,
    ).toBeNull();
  });

  it('accumulates shell_output into the terminal buffer and toggles running', () => {
    const streaming = reduceAgentControllerEvents(emptyTranscript(), [
      { type: 'shell_output', toolCallId: 'c1', output: 'line 1\n', stream: 'stdout' },
      { type: 'shell_output', toolCallId: 'c1', output: 'line 2\n', stream: 'stderr' },
    ]);
    expect(streaming.terminal.output).toBe('line 1\nline 2\n');
    expect(streaming.terminal.running).toBe(true);
    // the command settling drops the streaming caret but keeps the scrollback
    const settled = reduceAgentControllerEvent(streaming, { type: 'tool_end', toolCallId: 'c1' });
    expect(settled.terminal.running).toBe(false);
    expect(settled.terminal.output).toBe('line 1\nline 2\n');
  });

  it('maps the v4-nested tool-invocation shape to a paired tool_call + tool_result', () => {
    // The exact shape Mastra core ≥1.52 emits on message_end (captured from the
    // real AIMock stream): a `tool-invocation` part with data under `toolInvocation`.
    const s = reduceAgentControllerEvent(emptyTranscript(), {
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
    const s = reduceAgentControllerEvent(emptyTranscript(), {
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
    const ready = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'workspace_ready',
      workspaceId: 'w1',
      workspaceName: 'chat-workspace',
    });
    expect(ready.workspace).toMatchObject({ status: 'ready', name: 'chat-workspace' });
    // a later status transition replaces the snapshot
    const pending = reduceAgentControllerEvent(ready, {
      type: 'workspace_status_changed',
      status: 'pending',
    });
    expect(pending.workspace).toMatchObject({ status: 'pending' });
    // an error carries its message
    const failed = reduceAgentControllerEvent(pending, {
      type: 'workspace_error',
      error: 'sandbox down',
    });
    expect(failed.workspace).toMatchObject({ status: 'error', error: 'sandbox down' });
  });

  it('folds a full subagent lifecycle into one run, keyed by toolCallId', () => {
    const s = reduceAgentControllerEvents(emptyTranscript(), [
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
    const s = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'subagent_text_delta',
      toolCallId: 'sa9',
      textDelta: 'hi',
    });
    expect(s.subagents[0]).toMatchObject({ toolCallId: 'sa9', text: 'hi', status: 'running' });
  });

  it('reflects the active mode from mode_changed', () => {
    const s = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'mode_changed',
      modeId: 'plan',
      previousModeId: 'chat',
    });
    expect(s.activeMode).toBe('plan');
  });

  it('folds goal_evaluation into the goal card (objective, iteration, verdict)', () => {
    // First evaluation: not passed yet, one iteration of three.
    const first = reduceAgentControllerEvent(emptyTranscript(), {
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
    const done = reduceAgentControllerEvent(first, {
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

  it('folds om_status into the memory token windows + buffer state', () => {
    const s = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'om_status',
      windows: {
        active: {
          messages: { tokens: 6226, threshold: 3000 },
          observations: { tokens: 120, threshold: 40000 },
        },
        buffered: {
          observations: { status: 'idle', chunks: 2 },
          reflection: { status: 'running' },
        },
      },
      recordId: 'r1',
      threadId: 't1',
    });
    expect(s.memory?.status).toMatchObject({
      messages: { tokens: 6226, threshold: 3000 },
      observations: { tokens: 120, threshold: 40000 },
      observationBuffer: { status: 'idle', chunks: 2 },
      reflectionBuffer: { status: 'running' },
    });
  });

  it('accumulates om lifecycle events into the memory activity log (bounded, newest last)', () => {
    const s = reduceAgentControllerEvents(emptyTranscript(), [
      {
        type: 'om_observation_start',
        cycleId: 'c1',
        operationType: 'observation',
        tokensToObserve: 3200,
      },
      {
        type: 'om_observation_end',
        cycleId: 'c1',
        durationMs: 812,
        tokensObserved: 3200,
        observationTokens: 90,
        observations: 'User runs a coffee roastery named Ember; prefers concise answers.',
      },
      {
        type: 'om_activation',
        cycleId: 'c1',
        operationType: 'observation',
        chunksActivated: 1,
        tokensActivated: 90,
      },
    ]);
    expect(s.memory?.activity).toHaveLength(3);
    expect(s.memory?.activity[0]).toMatchObject({ kind: 'observe' });
    expect(s.memory?.activity.at(-1)).toMatchObject({ kind: 'activate' });
    // the distilled observations text surfaced from observation_end
    expect(s.memory?.observations).toContain('Ember');
  });

  it('surfaces a failed observation on the activity log', () => {
    const s = reduceAgentControllerEvent(emptyTranscript(), {
      type: 'om_observation_failed',
      cycleId: 'c1',
      error: 'model timeout',
      durationMs: 5,
    });
    expect(s.memory?.activity[0]).toMatchObject({ kind: 'observe', failed: true });
  });

  it('records the latest info status line', () => {
    const s = reduceAgentControllerEvents(emptyTranscript(), [
      { type: 'info', message: 'starting up' },
      { type: 'info', message: 'thinking…' },
    ]);
    expect(s.info).toBe('thinking…');
  });

  it('passes unknown events through untouched', () => {
    const before = emptyTranscript();
    // A genuinely unhandled event (om_status is now consumed → the Memory panel).
    const after = reduceAgentControllerEvent(before, { type: 'some_future_event', foo: 1 });
    expect(after).toEqual(before);
  });

  it('pairs tool results to calls by id', () => {
    const messages: AgentControllerMessage[] = [
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

  // ── Live tool-input streaming (698.25) ────────────────────────────────────────
  // Real captured order: tool_input_start → tool_input_delta×N → tool_input_end →
  // tool_start → message_update[tool-invocation] → tool_approval_required.
  describe('live tool-input streaming (activeTools, 698.25)', () => {
    it('builds an input-streaming activeTool as args deltas arrive', () => {
      const s = reduceAgentControllerEvents(emptyTranscript(), [
        { type: 'tool_input_start', toolCallId: 'c1', toolName: 'getWeather' },
        { type: 'tool_input_delta', toolCallId: 'c1', argsTextDelta: '{"loc' },
        { type: 'tool_input_delta', toolCallId: 'c1', argsTextDelta: 'ation":"Paris"}' },
      ]);
      expect(s.activeTools).toHaveLength(1);
      expect(s.activeTools[0]).toMatchObject({
        toolCallId: 'c1',
        name: 'getWeather',
        argsText: '{"location":"Paris"}',
        state: 'input-streaming',
      });
    });

    it('flips to input-available on tool_input_end / tool_start', () => {
      const base = reduceAgentControllerEvents(emptyTranscript(), [
        { type: 'tool_input_start', toolCallId: 'c1', toolName: 'getWeather' },
        { type: 'tool_input_delta', toolCallId: 'c1', argsTextDelta: '{}' },
      ]);
      const ended = reduceAgentControllerEvent(base, { type: 'tool_input_end', toolCallId: 'c1' });
      expect(ended.activeTools[0].state).toBe('input-available');
    });

    it('SUPPRESSES the live entry once the settled message tool_call part lands (no double-render)', () => {
      const streaming = reduceAgentControllerEvents(emptyTranscript(), [
        { type: 'tool_input_start', toolCallId: 'c1', toolName: 'getWeather' },
        { type: 'tool_input_delta', toolCallId: 'c1', argsTextDelta: '{"location":"Paris"}' },
        { type: 'tool_input_end', toolCallId: 'c1' },
        {
          type: 'tool_start',
          toolCallId: 'c1',
          toolName: 'getWeather',
          args: { location: 'Paris' },
        },
      ]);
      expect(streaming.activeTools).toHaveLength(1);
      // The settled message part for the SAME toolCallId arrives → the live entry is dropped.
      const settled = reduceAgentControllerEvent(streaming, {
        type: 'message_update',
        message: {
          id: 'm1',
          role: 'assistant',
          content: [
            { type: 'tool_call', id: 'c1', name: 'getWeather', args: { location: 'Paris' } },
          ],
        },
      });
      expect(settled.activeTools).toHaveLength(0); // suppressed — the message-part Tool wins
      expect(settled.messages).toHaveLength(1);
    });

    it('tool_start does not resurrect a live entry once its message part already exists', () => {
      const withPart = reduceAgentControllerEvent(emptyTranscript(), {
        type: 'message_update',
        message: {
          id: 'm1',
          role: 'assistant',
          content: [{ type: 'tool_call', id: 'c1', name: 'getWeather', args: {} }],
        },
      });
      const after = reduceAgentControllerEvent(withPart, {
        type: 'tool_start',
        toolCallId: 'c1',
        toolName: 'getWeather',
        args: {},
      });
      expect(after.activeTools).toHaveLength(0);
    });

    it('clears active tools when the run ends', () => {
      const streaming = reduceAgentControllerEvent(emptyTranscript(), {
        type: 'tool_input_start',
        toolCallId: 'c1',
        toolName: 'getWeather',
      });
      expect(streaming.activeTools).toHaveLength(1);
      expect(reduceAgentControllerEvent(streaming, { type: '__done__' }).activeTools).toHaveLength(
        0,
      );
      expect(reduceAgentControllerEvent(streaming, { type: 'agent_end' }).activeTools).toHaveLength(
        0,
      );
    });
  });
});
