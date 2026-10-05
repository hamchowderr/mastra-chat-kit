import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/chat-panel/chat-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fakeController, toolCallMessage } from './fake-controller';

/**
 * The side panel's Plan toggle: the shared PlanModeToggle and usePlanMode the full shell
 * uses. A turn sent with it on runs in Plan mode; the submitted plan's card approves it,
 * and the session's switch back to Chat turns the toggle off.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPanel = (props: { plan?: boolean } = {}) =>
  render(
    <TooltipProvider>
      <ChatPanel suggestions={[{ label: 'Go', prompt: 'Plan the launch' }]} {...props} />
    </TooltipProvider>,
  );

const userTurn = {
  type: 'message_end',
  message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Plan the launch' }] },
};

describe('ChatPanel — Plan', () => {
  it('shows the Plan toggle, and a turn sent with it on runs in Plan mode', async () => {
    const api = fakeController();
    renderPanel();
    const toggle = screen.getByRole('button', { name: /Plan/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('Go'));
    await waitFor(() => expect(api.sent('/api/agent-controller/stream')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/stream')[0].body).toMatchObject({
      text: 'Plan the launch',
      mode: 'plan',
    });
  });

  it("sends 'chat' while the toggle is off", async () => {
    const api = fakeController();
    renderPanel();
    fireEvent.click(screen.getByText('Go'));
    await waitFor(() => expect(api.sent('/api/agent-controller/stream')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/stream')[0].body?.mode).toBe('chat');
  });

  it('can be hidden, and then a turn names no mode', async () => {
    const api = fakeController();
    renderPanel({ plan: false });
    expect(screen.queryByRole('button', { name: /^Plan$/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Go'));
    await waitFor(() => expect(api.sent('/api/agent-controller/stream')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/stream')[0].body).not.toHaveProperty('mode');
  });

  it('approves the submitted plan, and the switch back to Chat turns the toggle off', async () => {
    const api = fakeController({
      stream: [
        { type: 'mode_changed', modeId: 'plan' },
        userTurn,
        toolCallMessage('p1', 'submit_plan', { path: 'plans/launch.md' }),
        {
          type: 'tool_suspended',
          toolCallId: 'p1',
          toolName: 'submit_plan',
          suspendPayload: { path: 'plans/launch.md' },
        },
      ],
      answer: [{ type: 'mode_changed', modeId: 'chat' }, { type: 'agent_end' }],
      files: { 'plans/launch.md': '# Launch plan\n\n1. Draft\n2. Ship' },
    });
    renderPanel();
    const toggle = screen.getByRole('button', { name: /Plan/ });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('Go'));

    expect(await screen.findByText('Launch plan')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Approve plan/ }));

    await waitFor(() => expect(api.sent('/api/agent-controller/answer')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/answer')[0].body).toEqual({
      plan: { action: 'approved' },
      toolCallId: 'p1',
    });
    expect(await screen.findByText(/switched to Chat mode/)).toBeInTheDocument();
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'false'));
  });
});
