'use client';

import type { ChatStatus } from 'ai';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, GlobeIcon } from 'lucide-react';
import { useState } from 'react';
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

type Provider = 'anthropic' | 'openai';
export type ModelOption = { id: string; name: string; provider: Provider };

// Model router ids (provider/model). Keep in sync with MODEL_ALLOWLIST in the
// server's mastra/index.ts. OpenAI entries are the cheaper chat tier on purpose.
export const MODELS: ModelOption[] = [
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'openai' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' },
  { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 nano', provider: 'openai' },
];

const MODEL_GROUPS: { provider: Provider; heading: string }[] = [
  { provider: 'anthropic', heading: 'Anthropic' },
  { provider: 'openai', heading: 'OpenAI' },
];

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
 * The ONE chat composer — full PromptInput surface (attachments + drag-drop,
 * action menu, web-search toggle, model selector, submit). Shared by BOTH the
 * Single Agent and Agent Harness chat views so the input never drifts between
 * engines — only the transport behind `onSend` changes.
 */
export function Composer({
  onSend,
  status,
  className = 'm-4',
}: {
  onSend: (submit: ComposerSubmit) => void;
  status?: ChatStatus;
  className?: string;
}) {
  const [text, setText] = useState('');
  const [model, setModel] = useState(MODELS[0].id);
  const [modelOpen, setModelOpen] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const currentModel = MODELS.find((m) => m.id === model) ?? MODELS[0];

  // The model selector pages by provider: arrows switch provider, its models list
  // underneath. Opening the palette starts on the current model's provider.
  const [activeProvider, setActiveProvider] = useState<Provider>(currentModel.provider);
  const providerIdx = Math.max(
    0,
    MODEL_GROUPS.findIndex((g) => g.provider === activeProvider),
  );
  const activeGroup = MODEL_GROUPS[providerIdx];
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
    onSend({ text: message.text ?? '', model, webSearch, files: message.files });
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
          placeholder="Ask anything…"
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
              <PromptInputActionAddScreenshot />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <PromptInputButton
            onClick={() => setWebSearch((v) => !v)}
            tooltip={{ content: 'Search the web', shortcut: '⌘K' }}
            variant={webSearch ? 'default' : 'ghost'}
            className="transition active:scale-[0.96]"
          >
            <GlobeIcon className="size-4" />
            <span>Search</span>
          </PromptInputButton>
          {/* The Model Selector element. Paged by provider: ◀ / ▶ switch provider,
              its models list underneath. The chosen model is sent on every turn via
              body.model and honored server-side. */}
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
                {MODELS.filter((mo) => mo.provider === activeProvider).map((mo) => (
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
        </PromptInputTools>
        <PromptInputSubmit disabled={!text.trim() && status !== 'streaming'} status={status} />
      </PromptInputFooter>
    </PromptInput>
  );
}
