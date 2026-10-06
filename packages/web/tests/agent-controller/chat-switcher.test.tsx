import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSwitcher } from '@/components/chat/chat-switcher';
import { WorkbenchPanel } from '@/components/chat/workbench-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';

/**
 * The host options on the full shell: what a project embedding the kit can change
 * without forking it — sizing, the workbench tabs, the empty-state suggestions and
 * greeting, the model picker and the web-search toggle. The defaults are pinned too,
 * so a project that passes nothing sees exactly the kit as before.
 */

// The sidebar and panels read /api/* on mount; answer them with empty lists.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ threads: [], schedules: [], tree: [], root: '' })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const renderShell = (props: Parameters<typeof ChatSwitcher>[0] = {}) =>
  render(
    <TooltipProvider>
      <ChatSwitcher {...props} />
    </TooltipProvider>,
  );

describe('ChatSwitcher — defaults', () => {
  it('fills the screen, offers the workbench, the demo suggestions, Search and the picker', () => {
    const { container } = renderShell();
    expect(container.firstElementChild?.className).toContain('h-dvh');
    expect(screen.getByLabelText('Show workbench')).toBeInTheDocument();
    expect(screen.getByText('Weather in LA')).toBeInTheDocument();
    expect(screen.getAllByText('Search').length).toBeGreaterThan(0);
    expect(screen.getByText('Sonnet 4.6')).toBeInTheDocument();
  });
});

describe('ChatSwitcher — host options', () => {
  it('sizes to the host layout with className', () => {
    const { container } = renderShell({ className: 'h-full' });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('h-full');
    expect(root.className).not.toContain('h-dvh');
  });

  it('shows the host’s suggestions and greeting instead of the demo ones', () => {
    renderShell({
      suggestions: [{ label: 'Grants closing soon', prompt: 'Which grants close this month?' }],
      greeting: { title: 'Hi Simone', description: 'Ask about your work.' },
    });
    expect(screen.getByText('Grants closing soon')).toBeInTheDocument();
    expect(screen.queryByText('Weather in LA')).not.toBeInTheDocument();
    expect(screen.getByText('Hi Simone')).toBeInTheDocument();
    expect(screen.getByText('Ask about your work.')).toBeInTheDocument();
  });

  it('hides the model picker and the Search toggle', () => {
    renderShell({ models: false, webSearch: false });
    expect(screen.queryByText('Sonnet 4.6')).not.toBeInTheDocument();
    expect(screen.queryByText('Search')).not.toBeInTheDocument();
  });

  it('limits the model picker to the host’s list', () => {
    renderShell({
      models: [{ id: 'anthropic/claude-haiku-4-5', name: 'Haiku', provider: 'anthropic' }],
    });
    expect(screen.getByText('Haiku')).toBeInTheDocument();
    expect(screen.queryByText('Sonnet 4.6')).not.toBeInTheDocument();
  });

  it('removes the workbench entirely with no tabs', () => {
    renderShell({ workbenchTabs: [] });
    expect(screen.queryByLabelText('Show workbench')).not.toBeInTheDocument();
  });
});

function Panel({ tabs }: { tabs?: Parameters<typeof WorkbenchPanel>[0]['tabs'] }) {
  const controller = useAgentControllerChat();
  return <WorkbenchPanel controller={controller} tabs={tabs} />;
}

describe('WorkbenchPanel — tabs', () => {
  it('shows all five tabs by default', () => {
    render(<Panel />);
    for (const name of ['Files', 'Terminal', 'Browser', 'Memory', 'Schedules']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('shows only the tabs it is given', () => {
    render(<Panel tabs={['memory', 'schedules']} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Memory', 'Schedules']);
  });
});

describe('ChatSwitcher — phones', () => {
  const width = window.innerWidth;
  beforeEach(() => {
    window.innerWidth = 420;
    const now = new Date().toISOString();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          threads: [{ id: 't1', title: 'Grant call', createdAt: now, updatedAt: now }],
          messages: [],
          schedules: [],
          tree: [],
          root: '',
        }),
      ),
    );
  });
  afterEach(() => {
    window.innerWidth = width;
  });

  it('starts with the conversations closed, and opens them over the chat as a sheet', async () => {
    renderShell();
    expect(screen.queryByRole('dialog', { name: 'Conversations' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show conversations'));
    const sheet = await screen.findByRole('dialog', { name: 'Conversations' });
    expect(within(sheet).getByText('New chat')).toBeInTheDocument();
  });

  it('closes the sheet when a conversation is chosen', async () => {
    renderShell();
    fireEvent.click(screen.getByLabelText('Show conversations'));
    const sheet = await screen.findByRole('dialog', { name: 'Conversations' });
    fireEvent.click(await within(sheet).findByText('Grant call'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Conversations' })).not.toBeInTheDocument(),
    );
  });

  it('closes the sheet on New chat', async () => {
    renderShell();
    fireEvent.click(screen.getByLabelText('Show conversations'));
    const sheet = await screen.findByRole('dialog', { name: 'Conversations' });
    fireEvent.click(within(sheet).getByText('New chat'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Conversations' })).not.toBeInTheDocument(),
    );
  });

  it('opens the workbench as a sheet', async () => {
    renderShell({ workbenchTabs: ['memory', 'schedules'] });
    fireEvent.click(screen.getByLabelText('Show workbench'));
    expect(await screen.findByRole('dialog', { name: 'Workbench' })).toBeInTheDocument();
  });
});
