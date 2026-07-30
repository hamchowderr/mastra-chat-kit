import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkbenchSchedules } from '@/components/chat/workbench-schedules';
import type { AgentControllerSchedule } from '@/lib/agent-controller/events';

// The Schedules panel renders the controller agent's recurring schedules (native
// mastra.schedules), fetched from /api/agent-controller/schedules. Read-only + agent-driven.
describe('WorkbenchSchedules — recurring schedules panel', () => {
  it('shows an empty state with no schedules', () => {
    render(<WorkbenchSchedules schedules={[]} />);
    expect(screen.getByText(/No recurring schedules yet/i)).toBeInTheDocument();
  });

  it('renders a schedule card with its cron, prompt, and active status', () => {
    const schedules: AgentControllerSchedule[] = [
      {
        id: 'agent_standup',
        cron: '0 9 * * *',
        prompt: 'Post the daily standup summary.',
        status: 'active',
        nextFireAt: Date.now() + 3 * 60 * 60 * 1000, // ~in 3h
        name: 'Standup',
      },
    ];
    render(<WorkbenchSchedules schedules={schedules} />);
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText('Post the daily standup summary.')).toBeInTheDocument();
    expect(screen.getByText('0 9 * * *')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    // Relative next-run hint is shown for active schedules.
    expect(screen.getByText(/next in \d+[mhd]/)).toBeInTheDocument();
  });

  it('marks paused schedules and hides their next-run time', () => {
    const schedules: AgentControllerSchedule[] = [
      {
        id: 'agent_paused',
        cron: '*/30 * * * *',
        prompt: 'Check the deploy status.',
        status: 'paused',
        nextFireAt: 0,
      },
    ];
    render(<WorkbenchSchedules schedules={schedules} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    // No name → the prompt titles the card; no "next" hint for a paused schedule.
    expect(screen.getByText('Check the deploy status.')).toBeInTheDocument();
    expect(screen.queryByText(/next in/)).not.toBeInTheDocument();
  });
});
