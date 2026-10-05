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
  // biome-ignore lint/suspicious/noExplicitAny: test-only global
  delete (URL as any).createObjectURL;
  // biome-ignore lint/suspicious/noExplicitAny: test-only global
  delete (URL as any).revokeObjectURL;
  vi.unstubAllGlobals();
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

  it('sends an image with an empty message box, as a data URL', async () => {
    // jsdom has no blob: URLs, so stand in for the browser's: createObjectURL hands out
    // a URL for the File, and fetching that URL returns the File. The conversion to a
    // data URL is PromptInput's own, and FileReader is jsdom's real one, so the URL sent
    // is built from the file's actual bytes. (A Response wrapping a jsdom Blob is not a
    // stand-in: Node 22's fetch throws on it, and Node 24 reads it as "[object Blob]".)
    const blobs = new Map<string, Blob>();
    URL.createObjectURL = (blob: Blob) => {
      const url = `blob:test/${blobs.size}`;
      blobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = (url: string) => void blobs.delete(url);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({ ok: true, blob: async () => blobs.get(url) })),
    );
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
    // "png" in base64. Never a blob: URL — the server refuses those.
    expect(sent.files).toEqual([
      expect.objectContaining({
        mediaType: 'image/png',
        filename: 'red.png',
        url: 'data:image/png;base64,cG5n',
      }),
    ]);
  });

  it('keeps the text and the attachment when the message is not sent', async () => {
    const blobs = new Map<string, Blob>();
    URL.createObjectURL = (blob: Blob) => {
      const url = `blob:test/${blobs.size}`;
      blobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = (url: string) => void blobs.delete(url);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({ ok: true, blob: async () => blobs.get(url) })),
    );
    // The skin reports the server refused the turn.
    const onSend = vi.fn(async () => false);
    renderComposer(onSend);
    const box = screen.getByPlaceholderText('How can I help?') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'What is this?' } });
    const file = new File(['png'], 'red.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText('red.png')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(box.value).toBe('What is this?'));
    expect(screen.getByAltText('red.png')).toBeInTheDocument();
  });

  it('clears the text and the attachment once the message is sent', async () => {
    const blobs = new Map<string, Blob>();
    URL.createObjectURL = (blob: Blob) => {
      const url = `blob:test/${blobs.size}`;
      blobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = (url: string) => void blobs.delete(url);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({ ok: true, blob: async () => blobs.get(url) })),
    );
    const onSend = vi.fn(async () => true);
    renderComposer(onSend);
    const box = screen.getByPlaceholderText('How can I help?') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Hello' } });
    const file = new File(['png'], 'red.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText('red.png')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.anything()] }));
    expect(box.value).toBe('');
    await waitFor(() => expect(screen.queryByAltText('red.png')).not.toBeInTheDocument());
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
