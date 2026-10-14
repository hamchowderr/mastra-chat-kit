import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';
import { fakeController } from './fake-controller';

/**
 * The engine's `approve`: it names the gate it answers, and a 409 is an error only when
 * this client never answered that gate. A repeat answer to a gate it already resolved
 * (the second click of a double click) is not news to the user.
 */

const gone = () =>
  Response.json(
    { error: 'approval not accepted: not_pending', reason: 'not_pending' },
    { status: 409 },
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAgentControllerChat approve', () => {
  it('is quiet about a 409 for a gate it already answered', async () => {
    let answered = false;
    const api = fakeController({
      approve: () => {
        if (answered) return gone();
        answered = true;
        return Response.json({ ok: true });
      },
    });
    const { result } = renderHook(() => useAgentControllerChat());

    let first = false;
    let second = true;
    await act(async () => {
      first = await result.current.approve('approve', 'c1');
    });
    await act(async () => {
      second = await result.current.approve('approve', 'c1');
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.transcript.error).toBeNull();
    expect(api.sent('/api/agent-controller/approve').map((c) => c.body)).toEqual([
      { decision: 'approve', toolCallId: 'c1' },
      { decision: 'approve', toolCallId: 'c1' },
    ]);
  });

  it('reports a 409 for a gate it never answered', async () => {
    fakeController({ approve: gone });
    const { result } = renderHook(() => useAgentControllerChat());

    await act(async () => {
      await result.current.approve('decline', 'c9');
    });

    expect(result.current.transcript.error).toBe('approval not accepted: not_pending');
  });

  it('sends nothing when there is no gate to answer', async () => {
    const api = fakeController();
    const { result } = renderHook(() => useAgentControllerChat());

    let sent = true;
    await act(async () => {
      sent = await result.current.approve('approve');
    });

    expect(sent).toBe(false);
    expect(api.sent('/api/agent-controller/approve')).toHaveLength(0);
  });
});
