import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('dictates into the message where the browser supports it, without sending it', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only global
    (window as any).webkitSpeechRecognition = FakeRecognition;
    const onSend = vi.fn();
    renderComposer(onSend);
    const mic = await screen.findByLabelText('Dictate');
    const box = screen.getByPlaceholderText('How can I help?') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Find grants' } });
    expect(mic).toHaveAttribute('type', 'button');
    fireEvent.click(mic);
    // PromptInput's submit is async (it converts attachments first): let it settle, so a
    // stray submit from the mic would have reached onSend by now.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(onSend).not.toHaveBeenCalled();
    act(() => FakeRecognition.last?.say('for packaging'));
    expect(box.value).toBe('Find grants for packaging');
  });

  it('sends an image with an empty message box', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:red', revokeObjectURL() {} }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['png'], { type: 'image/png' }))),
    );
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: PNG });
      this.onloadend?.({} as ProgressEvent<FileReader>);
    });
    const onSend = vi.fn();
    renderComposer(onSend);
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();

    const file = new File(['png'], 'red.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [file] } });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const sent = onSend.mock.calls[0][0];
    expect(sent.text).toBe('');
    expect(sent.files).toEqual([
      expect.objectContaining({ mediaType: 'image/png', filename: 'red.png', url: PNG }),
    ]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('turns away a file the server would refuse, and says why', async () => {
    renderComposer();
    const exe = new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' });
    fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [exe] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Attach an image, a PDF or a text file.',
    );
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });
});
