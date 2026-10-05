'use client';

import type { ChatStatus } from 'ai';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, GlobeIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import { SpeechInput } from '@/components/ai-elements/speech-input';

/** A model-router provider id, e.g. `anthropic`, `openai` — also picks the logo. */
type Provider = string;
export type ModelOption = { id: string; name: string; provider: Provider };

// Model router ids (provider/model). Keep in sync with MODEL_ALLOWLIST in the
// server's mastra/index.ts. OpenAI entries are the cheaper chat tier on purpose.
// `name` is the DISPLAY label — kept short (no "Claude" prefix; the provider logo
// beside it already conveys the vendor). OpenAI names keep "GPT" (it's the model
// name, not a vendor word).
export const MODELS: ModelOption[] = [
  { id: 'anthropic/claude-sonnet-4-6', name: 'Sonnet 4.6', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4-8', name: 'Opus 4.8', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5', name: 'Haiku 4.5', provider: 'anthropic' },
  { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'openai' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' },
  { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 nano', provider: 'openai' },
];

const PROVIDER_HEADINGS: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };

/** The picker's provider pages, in the order the models list them. */
function providerGroups(models: ModelOption[]): { provider: Provider; heading: string }[] {
  return [...new Set(models.map((m) => m.provider))].map((provider) => ({
    provider,
    heading: PROVIDER_HEADINGS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1),
  }));
}

export type ComposerSubmit = {
  text: string;
  model: string;
  webSearch: boolean;
  files?: PromptInputMessage['files'];
};

/** Renders the in-progress attachment chips above the textarea. */
function AttachmentsDisplay() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) {
    return null;
  }
  return (
    <Attachments variant="inline">
      {attachments.files.map((file) => (
        <Attachment data={file} key={file.id} onRemove={() => attachments.remove(file.id)}>
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  );
}

/**
 * Whether this browser can turn speech into text by itself (the Web Speech API:
 * Chrome, Edge, Safari 14.5+ incl. iOS). Checked after mount, so the server render and
 * the first client render agree; where it's missing the mic is simply not shown.
 */
function useSpeechRecognitionSupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  }, []);
  return supported;
}

/**
 * The ONE chat composer — full PromptInput surface (attachments + drag-drop,
 * action menu, web-search toggle, model selector, submit). Kept separate from
 * the chat view so the input surface can be reused behind any transport —
 * only the behaviour behind `onSend` changes.
 */
export function Composer({
  onSend,
  status,
  className = 'm-4',
  footerExtra,
  toolsExtra,
  models = MODELS,
  webSearch: showWebSearch = true,
  placeholder = 'Ask anything…',
  speech = true,
}: {
  onSend: (submit: ComposerSubmit) => void;
  status?: ChatStatus;
  className?: string;
  /** Rendered in the footer, right of the tools (e.g. the live token-usage Context). */
  footerExtra?: ReactNode;
  /** Rendered at the START of the tools row (e.g. the controller mode switcher). */
  toolsExtra?: ReactNode;
  /**
   * The models the picker offers, first one selected. `false` hides the picker, and each
   * turn then runs on the server's own CHAT_MODEL. The server only honours ids on its
   * model allowlist.
   */
  models?: ModelOption[] | false;
  /** Show the "Search the web" toggle. Hide it when the agent has no browser. */
  webSearch?: boolean;
  /** The textarea's placeholder. */
  placeholder?: string;
  /**
   * Show the microphone (AI Elements SpeechInput): dictation into the textarea. It only
   * appears where the browser has speech recognition built in; elsewhere there is no
   * button rather than a broken one.
   */
  speech?: boolean;
}) {
  const speechSupported = useSpeechRecognitionSupport();
  const modelList = models === false ? [] : models;
  const MODEL_GROUPS = providerGroups(modelList);
  const [text, setText] = useState('');
  const [model, setModel] = useState(modelList[0]?.id ?? '');
  const [modelOpen, setModelOpen] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const currentModel = modelList.find((m) => m.id === model) ?? modelList[0];

  // The model selector pages by provider: arrows switch provider, its models list
  // underneath. Opening the palette starts on the current model's provider.
  const [activeProvider, setActiveProvider] = useState<Provider>(currentModel?.provider ?? '');
  const providerIdx = Math.max(
    0,
    MODEL_GROUPS.findIndex((g) => g.provider === activeProvider),
  );
  const activeGroup = MODEL_GROUPS[providerIdx] ?? { provider: '', heading: '' };
  const cycleProvider = (dir: 1 | -1) =>
    setActiveProvider(
      MODEL_GROUPS[(providerIdx + dir + MODEL_GROUPS.length) % MODEL_GROUPS.length].provider,
    );

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text?.trim());
    const hasAttachments = Boolean(message.files?.length);
    if (!hasText && !hasAttachments) {
      return;
    }
    onSend({
      text: message.text ?? '',
      model,
      webSearch: showWebSearch && webSearch,
      files: message.files,
    });
    setText('');
  };

  return (
    <PromptInput onSubmit={handleSubmit} className={className} globalDrop multiple>
      <PromptInputHeader>
        <AttachmentsDisplay />
      </PromptInputHeader>
      <PromptInputBody>
        <PromptInputTextarea
          onChange={(e) => setText(e.target.value)}
          value={text}
          placeholder={placeholder}
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          {toolsExtra}
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger aria-label="Attach images or files" />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
              <PromptInputActionAddScreenshot />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          {showWebSearch && (
            <PromptInputButton
              onClick={() => setWebSearch((v) => !v)}
              tooltip={{ content: 'Search the web', shortcut: '⌘K' }}
              variant={webSearch ? 'default' : 'ghost'}
              className="transition active:scale-[0.96]"
            >
              <GlobeIcon className="size-4" />
              <span>Search</span>
            </PromptInputButton>
          )}
          {/* The Model Selector element. Paged by provider: ◀ / ▶ switch provider,
              its models list underneath. The chosen model is sent on every turn via
              body.model and honored server-side. */}
          {currentModel && (
            <ModelSelector
              open={modelOpen}
              onOpenChange={(open) => {
                setModelOpen(open);
                if (open) {
                  setActiveProvider(currentModel.provider);
                }
              }}
            >
              <ModelSelectorTrigger asChild>
                <PromptInputButton
                  variant="ghost"
                  tooltip={{ content: 'Choose model' }}
                  className="transition active:scale-[0.96]"
                >
                  <ModelSelectorLogo provider={currentModel.provider} />
                  <span>{currentModel.name}</span>
                </PromptInputButton>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                {/* Provider pager header — centered ◀ Provider ▶ cluster, kept clear of
                  the dialog's built-in ✕ (top-right) so the Next arrow stays clickable. */}
                <div className="flex items-center justify-center gap-3 border-border border-b px-2 py-2.5 pr-10">
                  <button
                    type="button"
                    aria-label="Previous provider"
                    onClick={() => cycleProvider(-1)}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.96]"
                  >
                    <ChevronLeftIcon className="size-4" />
                  </button>
                  <span className="flex w-28 items-center justify-center gap-1.5 font-medium text-sm">
                    <ModelSelectorLogo provider={activeProvider} />
                    {activeGroup.heading}
                  </span>
                  <button
                    type="button"
                    aria-label="Next provider"
                    onClick={() => cycleProvider(1)}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.96]"
                  >
                    <ChevronRightIcon className="size-4" />
                  </button>
                </div>
                {/* Models for the active provider */}
                <ModelSelectorList className="p-1.5">
                  {modelList
                    .filter((mo) => mo.provider === activeProvider)
                    .map((mo) => (
                      <ModelSelectorItem
                        key={mo.id}
                        value={mo.id}
                        className="my-0.5 gap-2"
                        onSelect={() => {
                          setModel(mo.id);
                          setModelOpen(false);
                        }}
                      >
                        <ModelSelectorLogo provider={mo.provider} />
                        <ModelSelectorName>{mo.name}</ModelSelectorName>
                        {model === mo.id && <CheckIcon className="size-4 text-muted-foreground" />}
                      </ModelSelectorItem>
                    ))}
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
          )}
        </PromptInputTools>
        <div className="flex items-center gap-2">
          {footerExtra}
          {speech && speechSupported && (
            <SpeechInput
              size="icon-sm"
              variant="ghost"
              aria-label="Dictate"
              onTranscriptionChange={(said) =>
                setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${said}` : said))
              }
            />
          )}
          <PromptInputSubmit disabled={!text.trim() && status !== 'streaming'} status={status} />
        </div>
      </PromptInputFooter>
    </PromptInput>
  );
}
