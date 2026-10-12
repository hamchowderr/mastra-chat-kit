import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalViewsProvider,
  BeforeAfter,
  humanizeToolName,
} from '@/components/chat/approval-view';
import { ApprovalCard } from '@/components/chat/transcript';
import type { PendingApproval } from '@/lib/agent-controller/events';
import type { UseAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';

/**
 * What an approval card says (components/chat/approval-view.tsx): the host's renderer for
 * the tool, with the server's preview; otherwise the tool in words and its arguments as
 * labelled fields, never raw JSON.
 */

const pending = (p: Partial<PendingApproval>): PendingApproval => ({
  toolCallId: 'c1',
  toolName: 'createTask',
  args: { title: 'Call the lab', dueDate: '2026-10-09', tags: ['lab', 'grant'] },
  category: 'edit',
  ...p,
});

function controllerWith(approval: PendingApproval) {
  return {
    transcript: { pendingApproval: approval },
    approve: vi.fn(),
  } as unknown as UseAgentControllerChat;
}

describe('humanizeToolName', () => {
  it('turns camelCase, kebab and snake names into words', () => {
    expect(humanizeToolName('createTask')).toBe('Create task');
    expect(humanizeToolName('fluent-crm-upsert-contact')).toBe('Fluent crm upsert contact');
    expect(humanizeToolName('mastra_workspace_write_file')).toBe('Mastra workspace write file');
  });
});

describe('ApprovalCard', () => {
  it('without a renderer: the tool in words and its arguments as labelled fields', () => {
    const { container } = render(<ApprovalCard controller={controllerWith(pending({}))} />);
    expect(screen.getByText('Create task?')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Call the lab')).toBeInTheDocument();
    expect(screen.getByText('Due date')).toBeInTheDocument();
    expect(screen.getByText('lab, grant')).toBeInTheDocument();
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).not.toContain('{');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Always allow edit tools' })).toBeInTheDocument();
  });

  it("with a renderer (prop or provider): the host's title and body, with the preview", () => {
    const views = {
      updatePage: ({ args, preview }: PendingApproval) => ({
        title: `Update the ${(args as { page: string }).page} page`,
        body: (
          <BeforeAfter
            before={(preview as { before: string }).before}
            after={(preview as { after: string }).after}
          />
        ),
      }),
    };
    const approval = pending({
      toolName: 'updatePage',
      args: { page: 'Series' },
      preview: { before: 'Work with us.', after: 'Work with us today.' },
    });
    const { unmount } = render(
      <ApprovalCard controller={controllerWith(approval)} views={views} />,
    );
    expect(screen.getByText('Update the Series page')).toBeInTheDocument();
    expect(screen.getByText('Work with us.')).toBeInTheDocument();
    expect(screen.getByText('Work with us today.')).toBeInTheDocument();
    unmount();

    render(
      <ApprovalViewsProvider views={views}>
        <ApprovalCard controller={controllerWith(approval)} />
      </ApprovalViewsProvider>,
    );
    expect(screen.getByText('Update the Series page')).toBeInTheDocument();
  });

  it('a renderer that returns null falls back to the default card', () => {
    render(
      <ApprovalCard controller={controllerWith(pending({}))} views={{ createTask: () => null }} />,
    );
    expect(screen.getByText('Create task?')).toBeInTheDocument();
  });
});
