import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GoalCard } from '@/components/chat/tool-views';

// The goal card renders the native goal-run state (objective, iteration budget, the
// judge's verdict, and its reason). Crafted props — the "a test per element" tier.
describe('GoalCard — goal-run element', () => {
  it('renders the objective, iteration budget, and a working status', () => {
    render(
      <GoalCard
        goal={{
          objective: 'Create hello.txt and prove it exists.',
          iteration: 1,
          maxRuns: 3,
          passed: false,
          status: 'active',
          reason: 'File not created yet — write it and verify.',
        }}
      />,
    );
    expect(screen.getByText('Create hello.txt and prove it exists.')).toBeInTheDocument();
    // Iteration counter renders as "<iteration> / <maxRuns>".
    expect(screen.getByText(/1\s*\/\s*3/)).toBeInTheDocument();
    expect(screen.getByText('Working…')).toBeInTheDocument();
    expect(screen.getByText('File not created yet — write it and verify.')).toBeInTheDocument();
  });

  it('shows a passed verdict when the judge completes the goal', () => {
    render(
      <GoalCard
        goal={{ objective: 'Ship it', passed: true, status: 'done', iteration: 2, maxRuns: 5 }}
      />,
    );
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('shows a waiting verdict when the judge wants user input', () => {
    render(
      <GoalCard goal={{ objective: 'Ask me first', status: 'active', waitingForUser: true }} />,
    );
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
  });

  it('renders a clear control when onClear is provided', () => {
    render(<GoalCard goal={{ objective: 'x' }} onClear={() => {}} />);
    expect(screen.getByLabelText('Clear goal')).toBeInTheDocument();
  });
});
