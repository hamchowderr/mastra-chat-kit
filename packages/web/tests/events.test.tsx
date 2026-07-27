import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EventsPage from '@/app/events/page';
import { eventCounts, HARNESS_EVENTS } from '@/lib/harness-event-map';

// The /events page is the single in-app reference: every harness event → the element it
// drives, with a copy-paste prompt for the user-triggerable ones.
describe('EventsPage — harness event → element reference', () => {
  it('renders the header and the real consumed/dropped counts', () => {
    const { consumed } = eventCounts();
    render(<EventsPage />);
    expect(screen.getByRole('heading', { name: /Harness events/i })).toBeInTheDocument();
    // "Consumed" appears on the summary tile + every consumed row chip.
    expect(screen.getAllByText('Consumed').length).toBeGreaterThan(0);
    expect(consumed).toBe(37); // guards against silent drift in the event map
  });

  it('lists event types and a copy-prompt for a triggerable event', () => {
    render(<EventsPage />);
    // A representative consumed event with a prompt (tool call).
    expect(screen.getByText('tool_start')).toBeInTheDocument();
    // Its copy-paste prompt is present (getWeather).
    expect(screen.getAllByText(/weather in Tokyo/i).length).toBeGreaterThan(0);
    // Copy-prompt buttons render for triggerable events.
    expect(screen.getAllByRole('button', { name: /copy prompt/i }).length).toBeGreaterThan(0);
  });

  it('marks a known dropped event as dropped', () => {
    render(<EventsPage />);
    // display_state_changed is intentionally off.
    const row = screen.getByText('display_state_changed').closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Dropped')).toBeInTheDocument();
  });

  it('every event in the map has a unique type + a target (element or plain surface)', () => {
    const types = HARNESS_EVENTS.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length); // no dupes
    for (const e of HARNESS_EVENTS) {
      expect(Boolean(e.element) || Boolean(e.target)).toBe(true);
    }
  });
});
