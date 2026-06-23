import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

// Browser-only elements (Rive WebGL2 personas, media-chrome audio, MediaDevices
// mic/voice pickers, ReactFlow canvas) can't run in jsdom — media-chrome even
// throws an async rejection on mount. They're verified live in the browser; here
// we stub their modules so the rest of the gallery can be smoke-tested. Each
// listed named export becomes a no-op component.
const { mk } = vi.hoisted(() => {
  const Stub = () => null;
  const mk = (...names: string[]) => {
    const m: Record<string, unknown> = { __esModule: true };
    for (const n of names) {
      m[n] = Stub;
    }
    return m;
  };
  return { mk };
});
vi.mock('@/components/ai-elements/audio-player', () =>
  mk(
    'AudioPlayer',
    'AudioPlayerControlBar',
    'AudioPlayerDurationDisplay',
    'AudioPlayerElement',
    'AudioPlayerMuteButton',
    'AudioPlayerPlayButton',
    'AudioPlayerSeekBackwardButton',
    'AudioPlayerSeekForwardButton',
    'AudioPlayerTimeDisplay',
  ),
);
vi.mock('@/components/ai-elements/mic-selector', () =>
  mk(
    'MicSelector',
    'MicSelectorContent',
    'MicSelectorInput',
    'MicSelectorTrigger',
    'MicSelectorValue',
  ),
);
vi.mock('@/components/ai-elements/speech-input', () => mk('SpeechInput'));
vi.mock('@/components/ai-elements/voice-selector', () =>
  mk(
    'VoiceSelector',
    'VoiceSelectorAccent',
    'VoiceSelectorAttributes',
    'VoiceSelectorBullet',
    'VoiceSelectorContent',
    'VoiceSelectorGender',
    'VoiceSelectorGroup',
    'VoiceSelectorInput',
    'VoiceSelectorItem',
    'VoiceSelectorList',
    'VoiceSelectorName',
    'VoiceSelectorTrigger',
  ),
);
vi.mock('@/components/ai-elements/persona', () => mk('Persona'));
vi.mock('@/components/showcase/showcase-canvas', () => mk('ShowcaseCanvas'));

// Imported after the mocks are registered.
const { default: ShowcasePage } = await import('@/app/showcase/page');

// The Showroom renders ALL 48 installed element modules across 5 categories.
// This proves the SSR-safe elements mount without throwing on their props.
describe('Showroom (/showcase)', () => {
  it('renders the full gallery across every category without crashing', () => {
    render(
      <TooltipProvider>
        <ShowcasePage />
      </TooltipProvider>,
    );

    expect(screen.getByText('mastra-chat-kit — Element Showroom')).toBeInTheDocument();

    // every category heading is present
    for (const cat of ['Chatbot', 'Code', 'Voice', 'Workflow', 'Utilities']) {
      expect(screen.getByRole('heading', { name: cat })).toBeInTheDocument();
    }

    // spot-check SSR-safe elements drawn from different categories
    expect(screen.getByText('Scaffold the chat shell')).toBeInTheDocument(); // Task (Chatbot)
    expect(screen.getByText(/Generating response/)).toBeInTheDocument(); // Shimmer (Chatbot)
    expect(screen.getByRole('heading', { name: 'Code Block' })).toBeInTheDocument(); // Code card
    expect(screen.getByText('feat: full Showroom of all 48 elements')).toBeInTheDocument(); // Commit (Code)
    expect(screen.getByText('Planning the response')).toBeInTheDocument(); // ChainOfThought (Workflow)
    expect(
      screen.getByText('48/48 element modules rendered.', { exact: false }),
    ).toBeInTheDocument();
  });
});
