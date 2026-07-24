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
