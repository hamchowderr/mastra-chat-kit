import { describe, expect, it } from 'vitest';
import { emptyTranscript } from '@/lib/agent-controller/events';
import { reduceAgentControllerEvents } from '@/lib/agent-controller/reduce';

/**
 * Core ≥1.69's message protocol: the full MastraDBMessage only on `message_start`, then
 * id-addressed `message_update` deltas, then an id-only `message_end`. Before this was
 * folded, an approved tool call stayed "Running" and the reply never rendered: every
 * update and end arrived without a `message` and was dropped.
 *
 * The sequence below is the one @mastra/core 1.69.0 emitted for the weather prompt
 * (captured from /agent-controller/stream, trimmed to the message events).
 */
const ASSISTANT_TOOL = 'b156cf47-99de-4705-aceb-cbe8d16339bd';
const ASSISTANT_TEXT = '2638f5ba-102f-4ed6-ad47-c74682209b07';
const call = { toolCallId: 'toolu_1', toolName: 'getWeather', args: { location: 'Los Angeles' } };

const weatherRun = [
  {
    type: 'message_start',
    message: {
      id: 'u1',
      role: 'signal',
      content: {
        format: 2,
        parts: [
          { type: 'data-user-message', data: { contents: "What's the weather in Los Angeles?" } },
        ],
      },
    },
  },
  { type: 'message_end', id: 'u1' },
  {
    type: 'message_start',
    message: {
      id: ASSISTANT_TOOL,
      role: 'assistant',
      content: {
        format: 2,
        parts: [{ type: 'tool-invocation', toolInvocation: { state: 'call', ...call } }],
      },
    },
  },
  {
    type: 'message_update',
    id: ASSISTANT_TOOL,
    event: {
      type: 'part',
      index: 0,
      part: {
        type: 'tool-invocation',
        toolInvocation: {
          state: 'result',
          ...call,
          result: { location: 'Los Angeles', temperatureC: 27, condition: 'Rainy' },
          isError: false,
        },
      },
    },
  },
  { type: 'message_end', id: ASSISTANT_TOOL },
  {
    type: 'message_start',
    message: {
      id: ASSISTANT_TEXT,
      role: 'assistant',
      content: { format: 2, parts: [{ type: 'text', text: '' }] },
    },
  },
  {
    type: 'message_update',
    id: ASSISTANT_TEXT,
    event: { type: 'text-delta', delta: 'The weather in Los A' },
  },
  {
    type: 'message_update',
    id: ASSISTANT_TEXT,
    event: { type: 'text-delta', delta: 'ngeles looks clear r' },
  },
  { type: 'message_update', id: ASSISTANT_TEXT, event: { type: 'text-delta', delta: 'ight now.' } },
  { type: 'message_end', id: ASSISTANT_TEXT },
];

describe('core ≥1.69 message deltas', () => {
  it('rebuilds the tool result and the streamed reply', () => {
    const s = reduceAgentControllerEvents(emptyTranscript(), weatherRun);

    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(s.messages[0].content).toEqual([
      { type: 'text', text: "What's the weather in Los Angeles?" },
    ]);
    // The `part` delta settled the call: a tool_call plus its paired result.
    expect(s.messages[1].content).toEqual([
      { type: 'tool_call', id: 'toolu_1', name: 'getWeather', args: call.args },
      {
        type: 'tool_result',
        id: 'toolu_1',
        name: 'getWeather',
        result: { location: 'Los Angeles', temperatureC: 27, condition: 'Rainy' },
        isError: false,
      },
    ]);
    expect(s.messages[2].content).toEqual([
      { type: 'text', text: 'The weather in Los Angeles looks clear right now.' },
    ]);
  });

  it('appends reasoning deltas to the reasoning part at their index', () => {
    const s = reduceAgentControllerEvents(emptyTranscript(), [
      {
        type: 'message_start',
        message: {
          id: 'a1',
          role: 'assistant',
          content: {
            format: 2,
            parts: [{ type: 'reasoning', reasoning: '', details: [] }],
          },
        },
      },
      {
        type: 'message_update',
        id: 'a1',
        event: { type: 'reasoning-delta', index: 0, delta: 'Search ' },
      },
      {
        type: 'message_update',
        id: 'a1',
        event: { type: 'reasoning-delta', index: 0, delta: 'first.' },
      },
      { type: 'message_update', id: 'a1', event: { type: 'text-delta', delta: 'Done.' } },
    ]);

    expect(s.messages[0].content).toEqual([
      { type: 'thinking', thinking: 'Search first.' },
      { type: 'text', text: 'Done.' },
    ]);
  });

  it('ignores a delta for a message it never saw start', () => {
    const before = emptyTranscript();
    const after = reduceAgentControllerEvents(before, [
      { type: 'message_update', id: 'nope', event: { type: 'text-delta', delta: 'x' } },
      { type: 'message_end', id: 'nope' },
    ]);
    expect(after.messages).toEqual([]);
  });
});
