import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '@/components/chat/composer';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * The shared composer's attach and dictate controls. Dictation uses the browser's own
 * speech recognition, so the mic only appears where that exists; elsewhere there is no
 * button at all (never a dead one).
 */

type Listener = (e: unknown) => void;
class FakeRecognition {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = 'en-US';
  listeners: Record<string, Listener[]> = {};
  constructor() {
    FakeRecognition.last = this;
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners[type] = [...(this.listeners[type] ?? []), fn];
  }
  removeEventListener() {}
  start() {
    for (const fn of this.listeners.start ?? []) fn({});
  }
  stop() {}
  say(text: string) {
    const result = Object.assign([{ transcript: text, confidence: 1 }], { isFinal: true });
    for (const fn of this.listeners.result ?? []) fn({ resultIndex: 0, results: [result] });
  }
}

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: test-only global
  delete (window as any).webkitSpeechRecognition;
});

const renderComposer = (onSend = vi.fn()) =>
  render(
    <TooltipProvider>
      <Composer onSend={onSend} models={false} webSearch={false} placeholder="How can I help?" />
    </TooltipProvider>,
  );

describe('Composer — attach and dictate', () => {
  it('always offers attachments', () => {
    renderComposer();
    expect(screen.getByLabelText('Attach images or files')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload files')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('How can I help?')).toBeInTheDocument();
  });

  it('shows no mic where the browser has no speech recognition', () => {
    renderComposer();
    expect(screen.queryByLabelText('Dictate')).not.toBeInTheDocument();
  });

  it('dictates into the message where the browser supports it', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only global
    (window as any).webkitSpeechRecognition = FakeRecognition;
    renderComposer();
    const mic = await screen.findByLabelText('Dictate');
    const box = screen.getByPlaceholderText('How can I help?') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Find grants' } });
    fireEvent.click(mic);
    act(() => FakeRecognition.last?.say('for packaging'));
    expect(box.value).toBe('Find grants for packaging');
  });
});
