import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkbenchMemory } from '@/components/chat/workbench-memory';
import type { HarnessMemory } from '@/lib/harness/events';

// The Memory panel renders the harness agent's Observational-Memory state (token
// windows toward observe/reflect + a lifecycle activity log), folded from om_* events.
describe('WorkbenchMemory — observational-memory panel', () => {
  it('shows an empty state before OM reports in', () => {
    render(<WorkbenchMemory memory={null} />);
    expect(screen.getByText(/Observational Memory distills/i)).toBeInTheDocument();
  });

  it('renders the token windows with tabular counts and the observations text', () => {
    const memory: HarnessMemory = {
      status: {
        messages: { tokens: 6226, threshold: 3000 },
        observations: { tokens: 120, threshold: 40000 },
        observationBuffer: { status: 'idle', chunks: 2 },
        reflectionBuffer: { status: 'idle' },
      },
      activity: [
        { kind: 'observe', detail: 'Observed in 812ms' },
        { kind: 'activate', detail: 'Activated 1 chunk(s) (90 tokens)' },
      ],
      observations: 'User runs a coffee roastery named Ember; prefers concise answers.',
    };
    render(<WorkbenchMemory memory={memory} />);
    // window labels
    expect(screen.getByText('Messages → observation')).toBeInTheDocument();
    expect(screen.getByText('Observations → reflection')).toBeInTheDocument();
    // formatted token counts (toLocaleString adds a comma at 6,226 / 40,000)
    expect(screen.getByText(/6,226 \/ 3,000/)).toBeInTheDocument();
    // distilled observations + activity
    expect(screen.getByText(/coffee roastery named Ember/)).toBeInTheDocument();
    expect(screen.getByText('Observed in 812ms')).toBeInTheDocument();
    expect(screen.getByText('Activated 1 chunk(s) (90 tokens)')).toBeInTheDocument();
  });
});
