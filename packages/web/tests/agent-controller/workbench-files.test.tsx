import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchFiles } from '@/components/chat/workbench-files';
import type { UseAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';

// WorkbenchFiles only reads controller.status (to refetch after a run); a minimal
// stub is enough for the rendering path.
const controller = { status: 'ready' } as unknown as UseAgentControllerChat;

const TREE = {
  root: '/ws',
  tree: [
    {
      name: 'src',
      path: 'src',
      type: 'dir',
      children: [{ name: 'hello.ts', path: 'src/hello.ts', type: 'file' }],
    },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ],
};

afterEach(() => vi.restoreAllMocks());

// The Files tab renders the workspace tree fetched from /api/workspace/files —
// this covers the client render that a headless browser can't (hydration quirk).
describe('WorkbenchFiles', () => {
  it('renders the workspace tree fetched on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => TREE,
    } as Response);

    render(<WorkbenchFiles controller={controller} />);

    await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument());
    expect(screen.getByText('src')).toBeInTheDocument();
  });
});
