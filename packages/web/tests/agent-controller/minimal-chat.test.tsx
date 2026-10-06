import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinimalChat } from '@/components/chat-minimal/minimal-chat';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fakeController, toolCallMessage } from './fake-controller';

/**
 * The minimal skin renders a submitted plan through the shared transcript pieces, so it
 * can approve one: without that the run would park on submit_plan with no way on.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MinimalChat', () => {
  it('shows a submitted plan and approves it', async () => {
    const api = fakeController({
      stream: [
        toolCallMessage('p1', 'submit_plan', { path: 'plans/ship.md' }),
        {
          type: 'tool_suspended',
          toolCallId: 'p1',
          toolName: 'submit_plan',
          suspendPayload: { path: 'plans/ship.md' },
        },
      ],
      files: { 'plans/ship.md': '# Ship the panel\n\n1. Build it\n2. Test it' },
    });
    render(
      <TooltipProvider>
        <MinimalChat />
      </TooltipProvider>,
    );
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Plan the release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Ship the panel')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Approve plan/ }));

    await waitFor(() => expect(api.sent('/api/agent-controller/answer')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/answer')[0].body).toEqual({
      plan: { action: 'approved' },
      toolCallId: 'p1',
      timeZone: expect.any(String),
    });
    expect(await screen.findByText(/Plan approved/)).toBeInTheDocument();
  });
});
