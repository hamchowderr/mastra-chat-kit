'use client';

import { jsonSchema } from 'ai';
import { CopyIcon, GlobeIcon, RotateCwIcon } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useState } from 'react';
import {
  Agent,
  AgentContent,
  AgentHeader,
  AgentInstructions,
  AgentOutput,
  AgentTool,
  AgentTools,
} from '@/components/ai-elements/agent';
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactClose,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from '@/components/ai-elements/artifact';
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments';
import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerDurationDisplay,
  AudioPlayerElement,
  AudioPlayerMuteButton,
  AudioPlayerPlayButton,
  AudioPlayerSeekBackwardButton,
  AudioPlayerSeekForwardButton,
  AudioPlayerTimeDisplay,
} from '@/components/ai-elements/audio-player';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought';
import { Checkpoint, CheckpointTrigger } from '@/components/ai-elements/checkpoint';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import {
  Commit,
  CommitActions,
  CommitAuthor,
  CommitAuthorAvatar,
  CommitContent,
  CommitCopyButton,
  CommitFile,
  CommitFileAdditions,
  CommitFileChanges,
  CommitFileDeletions,
  CommitFileIcon,
  CommitFileInfo,
  CommitFilePath,
  CommitFileStatus,
  CommitFiles,
  CommitHash,
  CommitHeader,
  CommitInfo,
  CommitMessage,
  CommitMetadata,
  CommitSeparator,
  CommitTimestamp,
} from '@/components/ai-elements/commit';
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@/components/ai-elements/confirmation';
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from '@/components/ai-elements/context';
import {
  Conversation,
  ConversationContent,
  ConversationDownload,
} from '@/components/ai-elements/conversation';
import {
  EnvironmentVariable,
  EnvironmentVariableCopyButton,
  EnvironmentVariableGroup,
  EnvironmentVariableName,
  EnvironmentVariables,
  EnvironmentVariablesContent,
  EnvironmentVariablesHeader,
  EnvironmentVariablesTitle,
  EnvironmentVariablesToggle,
  EnvironmentVariableValue,
} from '@/components/ai-elements/environment-variables';
import { FileTree, FileTreeFile, FileTreeFolder } from '@/components/ai-elements/file-tree';
import { Image } from '@/components/ai-elements/image';
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationQuote,
  InlineCitationSource,
  InlineCitationText,
} from '@/components/ai-elements/inline-citation';
import { JSXPreview, JSXPreviewContent } from '@/components/ai-elements/jsx-preview';
import {
  Message,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  MicSelector,
  MicSelectorContent,
  MicSelectorInput,
  MicSelectorTrigger,
  MicSelectorValue,
} from '@/components/ai-elements/mic-selector';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';
import {
  OpenIn,
  OpenInChatGPT,
  OpenInClaude,
  OpenInContent,
  OpenInCursor,
  OpenInLabel,
  OpenInTrigger,
  OpenInv0,
} from '@/components/ai-elements/open-in-chat';
import {
  PackageInfo,
  PackageInfoContent,
  PackageInfoDependencies,
  PackageInfoDependency,
  PackageInfoDescription,
} from '@/components/ai-elements/package-info';
import { Persona } from '@/components/ai-elements/persona';
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanFooter,
  PlanHeader,
  PlanTitle,
} from '@/components/ai-elements/plan';
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
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '@/components/ai-elements/queue';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import {
  Sandbox,
  SandboxContent,
  SandboxHeader,
  SandboxTabContent,
  SandboxTabs,
  SandboxTabsBar,
  SandboxTabsList,
  SandboxTabsTrigger,
} from '@/components/ai-elements/sandbox';
import {
  SchemaDisplay,
  SchemaDisplayContent,
  SchemaDisplayDescription,
  SchemaDisplayHeader,
  SchemaDisplayMethod,
  SchemaDisplayParameters,
  SchemaDisplayPath,
  SchemaDisplayRequest,
  SchemaDisplayResponse,
} from '@/components/ai-elements/schema-display';
import { Shimmer } from '@/components/ai-elements/shimmer';
import {
  Snippet,
  SnippetAddon,
  SnippetCopyButton,
  SnippetInput,
  SnippetText,
} from '@/components/ai-elements/snippet';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';
import { SpeechInput } from '@/components/ai-elements/speech-input';
import {
  StackTrace,
  StackTraceActions,
  StackTraceContent,
  StackTraceCopyButton,
  StackTraceError,
  StackTraceErrorMessage,
  StackTraceErrorType,
  StackTraceExpandButton,
  StackTraceFrames,
  StackTraceHeader,
} from '@/components/ai-elements/stack-trace';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import {
  Task,
  TaskContent,
  TaskItem,
  TaskItemFile,
  TaskTrigger,
} from '@/components/ai-elements/task';
import {
  Terminal,
  TerminalContent,
  TerminalHeader,
  TerminalTitle,
} from '@/components/ai-elements/terminal';
import {
  Test,
  TestError,
  TestErrorMessage,
  TestResults,
  TestResultsContent,
  TestResultsDuration,
  TestResultsHeader,
  TestResultsProgress,
  TestResultsSummary,
  TestSuite,
  TestSuiteContent,
  TestSuiteName,
} from '@/components/ai-elements/test-results';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { Transcription, TranscriptionSegment } from '@/components/ai-elements/transcription';
import {
  VoiceSelector,
  VoiceSelectorAccent,
  VoiceSelectorAttributes,
  VoiceSelectorBullet,
  VoiceSelectorContent,
  VoiceSelectorGender,
  VoiceSelectorGroup,
  VoiceSelectorInput,
  VoiceSelectorItem,
  VoiceSelectorList,
  VoiceSelectorName,
  VoiceSelectorTrigger,
} from '@/components/ai-elements/voice-selector';
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from '@/components/ai-elements/web-preview';
import { ClientOnly, Safe } from '@/components/showcase/client-only';
import { ShowcaseCanvas } from '@/components/showcase/showcase-canvas';

const SAMPLE_CODE = `export function greet(name: string) {
  return \`Hello, \${name}!\`;
}`;

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const FIXED_DATE = new Date('2026-06-22T12:00:00Z');

// All 7 ToolUIPart states — the full tool lifecycle incl. native HITL approval.
const TOOL_STATES = [
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
] as const;

const DOWNLOAD_MESSAGES = [
  { id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
  { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'Hello! How can I help?' }] },
  // biome-ignore lint/suspicious/noExplicitAny: minimal UIMessage[] shape for the download demo
] as any;

function Category({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 border-border border-b pb-1 font-bold text-lg">{title}</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Card({
  title,
  note,
  wide,
  children,
}: {
  title: string;
  note?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-lg border border-border bg-card p-4 ${wide ? 'md:col-span-2' : ''}`}
    >
      <header>
        <h3 className="font-semibold text-sm">{title}</h3>
        {note && <p className="text-muted-foreground text-xs">{note}</p>}
      </header>
      {/* Each element is isolated: one failing element never blanks the gallery. */}
      <div className="rounded-md bg-background p-3">
        <Safe label={title}>{children}</Safe>
      </div>
    </section>
  );
}

export default function ShowcasePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <nav className="mb-6 flex items-center gap-4 text-sm">
        <Link href="/" className="text-muted-foreground hover:text-foreground">
          ← Chat
        </Link>
        <span className="font-medium text-foreground">Showroom</span>
        <Link href="/status" className="text-muted-foreground hover:text-foreground">
          Wiring Status
        </Link>
      </nav>

      <header className="mb-2">
        <h1 className="font-bold text-2xl">mastra-chat-kit — Element Showroom</h1>
        <p className="text-muted-foreground text-sm">
          Every one of the 48 installed AI Elements rendered with real props, grouped by category.
          The same components the chat shell uses, driven by either engine (Single Agent / Agent
          Harness). Nothing stripped. See{' '}
          <Link href="/status" className="underline underline-offset-2">
            Wiring Status
          </Link>{' '}
          for what each one is actually driven by.
        </p>
      </header>

      {/* ---------------------------------------------------------------- Chatbot */}
      <Category title="Chatbot">
        <Card title="Conversation + Message + Response" note="user & assistant turns, markdown">
          <Conversation className="h-auto">
            <ConversationContent>
              <Message from="user">
                <MessageContent>What's the weather in Los Angeles?</MessageContent>
              </Message>
              <Message from="assistant">
                <MessageContent>
                  <MessageResponse>
                    {'The weather in **Los Angeles** is clear, ~22°C.'}
                  </MessageResponse>
                </MessageContent>
              </Message>
            </ConversationContent>
          </Conversation>
        </Card>

        <Card title="Suggestion" note="prompt pills">
          <Suggestions>
            <Suggestion suggestion="Summarize this" onClick={() => {}} />
            <Suggestion suggestion="Explain like I'm 5" onClick={() => {}} />
            <Suggestion suggestion="Show me the code" onClick={() => {}} />
          </Suggestions>
        </Card>

        <Card
          title="Prompt Input"
          note="full surface: attachments, action menu, web search, model picker, submit"
          wide
        >
          <ShowroomPromptInput />
        </Card>

        <Card title="Reasoning" note="collapsible extended-thinking">
          <Reasoning isStreaming={false} defaultOpen duration={3}>
            <ReasoningTrigger />
            <ReasoningContent>
              {'The user asked about weather, so I should call the getWeather tool first.'}
            </ReasoningContent>
          </Reasoning>
        </Card>

        <Card title="Tool" note="input params + output, with state badge">
          <Tool defaultOpen>
            <ToolHeader type="tool-getWeather" state="output-available" />
            <ToolContent>
              <ToolInput input={{ location: 'Los Angeles' }} />
              <ToolOutput
                output={<span className="text-sm">Clear, 22°C</span>}
                errorText={undefined}
              />
            </ToolContent>
          </Tool>
        </Card>

        <Card title="Tool — all 7 states" note="full lifecycle incl. native HITL approval">
          <div className="flex flex-col gap-2">
            {TOOL_STATES.map((state) => (
              <Tool key={state}>
                <ToolHeader type="tool-getWeather" state={state} />
              </Tool>
            ))}
          </div>
        </Card>

        <Card title="Message branching" note="regenerated variants with prev/next">
          <MessageBranch defaultBranch={0}>
            <MessageBranchContent>
              {/* MessageBranchContent keys each branch by the child's own `key` — must be unique. */}
              <MessageResponse key="branch-0">The weather in LA is clear, ~22°C.</MessageResponse>
              <MessageResponse key="branch-1">
                It's sunny in Los Angeles right now — about 22°C.
              </MessageResponse>
            </MessageBranchContent>
            <MessageBranchSelector>
              <MessageBranchPrevious />
              <MessageBranchPage />
              <MessageBranchNext />
            </MessageBranchSelector>
          </MessageBranch>
        </Card>

        <Card title="Sources" note="collapsible source list (RAG citations)">
          <Sources>
            <SourcesTrigger count={2} />
            <SourcesContent>
              <Source href="https://mastra.ai/docs/memory" title="Mastra Memory — Overview" />
              <Source href="https://ai-sdk.dev/elements" title="AI Elements" />
            </SourcesContent>
          </Sources>
        </Card>

        <Card title="Inline Citation" note="inline ref + hover-card source carousel">
          <p className="text-sm">
            Mastra supports semantic recall{' '}
            <InlineCitation>
              <InlineCitationText>across threads</InlineCitationText>
              <InlineCitationCard>
                <InlineCitationCardTrigger
                  sources={['https://mastra.ai/docs/memory', 'https://ai-sdk.dev/elements']}
                />
                <InlineCitationCardBody>
                  <InlineCitationCarousel>
                    <InlineCitationCarouselHeader>
                      <InlineCitationCarouselPrev />
                      <InlineCitationCarouselIndex />
                      <InlineCitationCarouselNext />
                    </InlineCitationCarouselHeader>
                    <InlineCitationCarouselContent>
                      <InlineCitationCarouselItem>
                        <InlineCitationSource
                          title="Mastra Memory"
                          url="https://mastra.ai/docs/memory"
                          description="Semantic recall + working memory across threads."
                        />
                        <InlineCitationQuote>
                          Memory enables recall of prior context across conversations.
                        </InlineCitationQuote>
                      </InlineCitationCarouselItem>
                      <InlineCitationCarouselItem>
                        <InlineCitationSource
                          title="AI Elements"
                          url="https://ai-sdk.dev/elements"
                          description="The component layer rendering this citation."
                        />
                      </InlineCitationCarouselItem>
                    </InlineCitationCarouselContent>
                  </InlineCitationCarousel>
                </InlineCitationCardBody>
              </InlineCitationCard>
            </InlineCitation>
            .
          </p>
        </Card>

        <Card title="Task" note="collapsible task with files">
          <Task defaultOpen>
            <TaskTrigger title="Scaffold the chat shell" />
            <TaskContent>
              <TaskItem>Created the canonical Chat component</TaskItem>
              <TaskItem>
                Wrote <TaskItemFile>chat.tsx</TaskItemFile> and{' '}
                <TaskItemFile>single-agent.ts</TaskItemFile>
              </TaskItem>
            </TaskContent>
          </Task>
        </Card>

        <Card title="Context" note="token/context-window usage popover">
          <Context
            usedTokens={5000}
            maxTokens={200000}
            modelId="anthropic/claude-sonnet-4-6"
            usage={{ inputTokens: 3200, outputTokens: 1800, totalTokens: 5000 }}
          >
            <ContextTrigger />
            <ContextContent>
              <ContextContentHeader />
              <ContextContentBody>
                <ContextInputUsage />
                <ContextOutputUsage />
                <ContextReasoningUsage />
                <ContextCacheUsage />
              </ContextContentBody>
              <ContextContentFooter />
            </ContextContent>
          </Context>
        </Card>

        <Card title="Image" note="model-generated image (base64)">
          <Image
            base64={TINY_PNG}
            mediaType="image/png"
            alt="Generated"
            className="size-16 border"
          />
        </Card>

        <Card title="Confirmation — HITL states" note="requested → accepted / denied" wide>
          <div className="flex flex-col gap-3">
            <Confirmation
              state="approval-requested"
              approval={{ id: 'tool-1', approved: undefined }}
            >
              <ConfirmationTitle>Run deleteFile?</ConfirmationTitle>
              <ConfirmationRequest>
                <p className="text-sm">This will permanently remove report.pdf.</p>
                <ConfirmationActions>
                  <ConfirmationAction onClick={() => {}}>Approve</ConfirmationAction>
                  <ConfirmationAction variant="outline" onClick={() => {}}>
                    Reject
                  </ConfirmationAction>
                </ConfirmationActions>
              </ConfirmationRequest>
            </Confirmation>

            <Confirmation state="output-available" approval={{ id: 'tool-2', approved: true }}>
              <ConfirmationTitle>Run deleteFile?</ConfirmationTitle>
              <ConfirmationAccepted>Approved — report.pdf removed.</ConfirmationAccepted>
            </Confirmation>

            <Confirmation state="output-denied" approval={{ id: 'tool-3', approved: false }}>
              <ConfirmationTitle>Run deleteFile?</ConfirmationTitle>
              <ConfirmationRejected>Denied — no changes made.</ConfirmationRejected>
            </Confirmation>
          </div>
        </Card>

        <Card title="Queue" note="pending agent task queue">
          <Queue>
            <QueueSection defaultOpen>
              <QueueSectionTrigger>
                <QueueSectionLabel count={2} label="pending" />
              </QueueSectionTrigger>
              <QueueSectionContent>
                <QueueList>
                  <QueueItem>
                    <QueueItemIndicator completed={false} />
                    <QueueItemContent completed={false}>Fetch weather</QueueItemContent>
                    <QueueItemDescription>tool: getWeather</QueueItemDescription>
                  </QueueItem>
                  <QueueItem>
                    <QueueItemIndicator completed={false} />
                    <QueueItemContent completed={false}>Summarize result</QueueItemContent>
                  </QueueItem>
                </QueueList>
              </QueueSectionContent>
            </QueueSection>
          </Queue>
        </Card>

        <Card title="Open In Chat" note="send this conversation to another assistant">
          <OpenIn query="How do I wire Mastra memory into a chat route?">
            <OpenInTrigger />
            <OpenInContent>
              <OpenInLabel>Open in</OpenInLabel>
              <OpenInChatGPT />
              <OpenInClaude />
              <OpenInv0 />
              <OpenInCursor />
            </OpenInContent>
          </OpenIn>
        </Card>

        <Card title="Shimmer" note="streaming/loading text">
          <Shimmer>Generating response…</Shimmer>
        </Card>
      </Category>

      {/* ------------------------------------------------------------------- Code */}
      <Category title="Code">
        <Card title="Code Block" note="syntax highlight + copy">
          <CodeBlock code={SAMPLE_CODE} language="ts">
            <CodeBlockCopyButton />
          </CodeBlock>
        </Card>

        <Card title="Snippet" note="single-line copyable command">
          <Snippet code="npx ai-elements@latest">
            <SnippetAddon>
              <SnippetText>$</SnippetText>
            </SnippetAddon>
            <SnippetInput />
            <SnippetAddon>
              <SnippetCopyButton />
            </SnippetAddon>
          </Snippet>
        </Card>

        <Card title="Agent" note="agent definition: instructions + tools + output schema">
          <Agent>
            <AgentHeader name="chatAgent" model="claude-sonnet-4-6" />
            <AgentContent>
              <AgentInstructions>Answer questions and call tools when useful.</AgentInstructions>
              <AgentTools type="multiple">
                <AgentTool
                  value="getWeather"
                  tool={{
                    description: 'Get weather for a city',
                    inputSchema: jsonSchema({ type: 'object', properties: {} }),
                  }}
                />
              </AgentTools>
              <AgentOutput schema={'interface Output { answer: string }'} />
            </AgentContent>
          </Agent>
        </Card>

        <Card title="Artifact" note="generated document/code panel">
          <Artifact>
            <ArtifactHeader>
              <div>
                <ArtifactTitle>weather-card.tsx</ArtifactTitle>
                <ArtifactDescription>Generated React component</ArtifactDescription>
              </div>
              <ArtifactActions>
                <ArtifactAction tooltip="Copy" icon={CopyIcon} />
                <ArtifactClose />
              </ArtifactActions>
            </ArtifactHeader>
            <ArtifactContent>
              <CodeBlock code={SAMPLE_CODE} language="ts" />
            </ArtifactContent>
          </Artifact>
        </Card>

        <Card title="File Tree" note="project file navigator">
          <FileTree defaultExpanded={new Set(['src'])} selectedPath="src/index.ts">
            <FileTreeFolder path="src" name="src">
              <FileTreeFile path="src/index.ts" name="index.ts" />
              <FileTreeFile path="src/chat.tsx" name="chat.tsx" />
            </FileTreeFolder>
            <FileTreeFile path="README.md" name="README.md" />
          </FileTree>
        </Card>

        <Card title="Terminal" note="command output (ANSI aware)">
          <Terminal output={'$ pnpm test\n✓ 56 passed (56)'} isStreaming={false}>
            <TerminalHeader>
              <TerminalTitle>build output</TerminalTitle>
            </TerminalHeader>
            <TerminalContent />
          </Terminal>
        </Card>

        <Card title="Sandbox" note="preview/code tabs" wide>
          <Sandbox>
            <SandboxHeader title="weather-card demo" state="output-available" />
            <SandboxContent>
              <SandboxTabs defaultValue="preview">
                <SandboxTabsBar>
                  <SandboxTabsList>
                    <SandboxTabsTrigger value="preview">Preview</SandboxTabsTrigger>
                    <SandboxTabsTrigger value="code">Code</SandboxTabsTrigger>
                  </SandboxTabsList>
                </SandboxTabsBar>
                <SandboxTabContent value="preview">
                  <p className="text-sm">Clear, 22°C in Los Angeles ☀️</p>
                </SandboxTabContent>
                <SandboxTabContent value="code">
                  <CodeBlock code={SAMPLE_CODE} language="ts" />
                </SandboxTabContent>
              </SandboxTabs>
            </SandboxContent>
          </Sandbox>
        </Card>

        <Card title="Commit" note="git commit with file changes" wide>
          <Commit>
            <CommitHeader>
              <CommitInfo>
                <div>
                  <CommitHash>a1b2c3d</CommitHash>
                  <CommitMessage>feat: full Showroom of all 48 elements</CommitMessage>
                </div>
                <CommitMetadata>
                  <CommitAuthor>
                    <CommitAuthorAvatar initials="CH" />
                    <span>Chowderr</span>
                  </CommitAuthor>
                  <CommitSeparator />
                  <CommitTimestamp date={FIXED_DATE} />
                </CommitMetadata>
              </CommitInfo>
              <CommitActions>
                <CommitCopyButton hash="a1b2c3d" />
              </CommitActions>
            </CommitHeader>
            <CommitContent>
              <CommitFiles>
                <CommitFile>
                  <CommitFileInfo>
                    <CommitFileStatus status="modified" />
                    <CommitFileIcon />
                    <CommitFilePath>app/showcase/page.tsx</CommitFilePath>
                  </CommitFileInfo>
                  <CommitFileChanges>
                    <CommitFileAdditions count={420} />
                    <CommitFileDeletions count={12} />
                  </CommitFileChanges>
                </CommitFile>
              </CommitFiles>
            </CommitContent>
          </Commit>
        </Card>

        <Card title="Environment Variables" note="masked env with reveal toggle">
          <EnvironmentVariables defaultShowValues={false}>
            <EnvironmentVariablesHeader>
              <EnvironmentVariablesTitle>API Keys</EnvironmentVariablesTitle>
              <EnvironmentVariablesToggle />
            </EnvironmentVariablesHeader>
            <EnvironmentVariablesContent>
              <EnvironmentVariable name="ANTHROPIC_API_KEY" value="sk-ant-REDACTED-EXAMPLE">
                <EnvironmentVariableName />
                <EnvironmentVariableGroup>
                  <EnvironmentVariableValue />
                  <EnvironmentVariableCopyButton copyFormat="export" />
                </EnvironmentVariableGroup>
              </EnvironmentVariable>
            </EnvironmentVariablesContent>
          </EnvironmentVariables>
        </Card>

        <Card title="Package Info" note="dependency upgrade summary">
          <PackageInfo
            name="@mastra/core"
            currentVersion="1.44.0"
            newVersion="1.45.0"
            changeType="minor"
          >
            <PackageInfoDescription>Adds the Agent Harness API.</PackageInfoDescription>
            <PackageInfoContent>
              <PackageInfoDependencies>
                <PackageInfoDependency name="@mastra/ai-sdk" version="^1.5.0" />
                <PackageInfoDependency name="ai" version="^6.0.208" />
              </PackageInfoDependencies>
            </PackageInfoContent>
          </PackageInfo>
        </Card>

        <Card title="JSX Preview" note="render model-authored JSX">
          <JSXPreview
            jsx={'<button class="rounded bg-black px-3 py-1 text-white">Click me</button>'}
            isStreaming={false}
          >
            <JSXPreviewContent />
          </JSXPreview>
        </Card>

        <Card title="Schema Display" note="API endpoint schema" wide>
          <SchemaDisplay
            method="POST"
            path="/chat/:agentId"
            description="Stream a chat completion from a Mastra agent."
            parameters={[
              {
                name: 'agentId',
                type: 'string',
                required: true,
                location: 'path',
                description: 'Agent id',
              },
            ]}
            requestBody={[
              {
                name: 'messages',
                type: 'UIMessage[]',
                required: true,
                description: 'Chat history',
              },
            ]}
            responseBody={[
              { name: 'stream', type: 'UIMessageChunk', required: true, description: 'SSE stream' },
            ]}
          >
            <SchemaDisplayHeader>
              <div className="flex items-center gap-3">
                <SchemaDisplayMethod />
                <SchemaDisplayPath />
              </div>
            </SchemaDisplayHeader>
            <SchemaDisplayDescription />
            <SchemaDisplayContent>
              <SchemaDisplayParameters />
              <SchemaDisplayRequest />
              <SchemaDisplayResponse />
            </SchemaDisplayContent>
          </SchemaDisplay>
        </Card>

        <Card title="Stack Trace" note="parsed error with clickable frames" wide>
          <StackTrace
            trace={
              "TypeError: Cannot read property 'location' of undefined\n  at getWeather (/src/tools.ts:15:10)\n  at chatAgent (/src/agents/chat.ts:42:7)"
            }
            defaultOpen
          >
            <StackTraceHeader>
              <StackTraceError>
                <StackTraceErrorType />
                <StackTraceErrorMessage />
              </StackTraceError>
              <StackTraceActions>
                <StackTraceCopyButton />
                <StackTraceExpandButton />
              </StackTraceActions>
            </StackTraceHeader>
            <StackTraceContent>
              <StackTraceFrames />
            </StackTraceContent>
          </StackTrace>
        </Card>

        <Card title="Test Results" note="suite pass/fail summary" wide>
          <TestResults summary={{ passed: 56, failed: 1, skipped: 0, total: 57, duration: 3421 }}>
            <TestResultsHeader>
              <TestResultsSummary />
              <TestResultsDuration />
            </TestResultsHeader>
            <TestResultsProgress />
            <TestResultsContent>
              <TestSuite name="elements" status="failed" defaultOpen>
                <TestSuiteName />
                <TestSuiteContent>
                  <Test name="renders message" status="passed" duration={12} />
                  <Test name="renders tool output" status="failed" duration={9}>
                    <TestError>
                      <TestErrorMessage>Expected badge to be visible</TestErrorMessage>
                    </TestError>
                  </Test>
                </TestSuiteContent>
              </TestSuite>
            </TestResultsContent>
          </TestResults>
        </Card>

        <Card title="Web Preview" note="live iframe with nav bar" wide>
          <WebPreview defaultUrl="https://ai-sdk.dev/elements">
            <WebPreviewNavigation>
              <WebPreviewNavigationButton tooltip="Reload">
                <RotateCwIcon className="size-4" />
              </WebPreviewNavigationButton>
              <WebPreviewUrl />
            </WebPreviewNavigation>
            <WebPreviewBody className="h-64" />
          </WebPreview>
        </Card>
      </Category>

      {/* ------------------------------------------------------------------ Voice */}
      <Category title="Voice">
        <Card title="Audio Player" note="speech playback (media-chrome)">
          <ClientOnly
            fallback={<p className="text-muted-foreground text-xs">Loading audio player…</p>}
          >
            <AudioPlayer>
              <AudioPlayerElement src={SILENT_WAV} />
              <AudioPlayerControlBar>
                <AudioPlayerPlayButton />
                <AudioPlayerSeekBackwardButton seekOffset={10} />
                <AudioPlayerTimeDisplay />
                <AudioPlayerSeekForwardButton seekOffset={10} />
                <AudioPlayerDurationDisplay />
                <AudioPlayerMuteButton />
              </AudioPlayerControlBar>
            </AudioPlayer>
          </ClientOnly>
        </Card>

        <Card title="Mic Selector" note="choose input device (MediaDevices)">
          <ClientOnly
            fallback={<p className="text-muted-foreground text-xs">Loading mic selector…</p>}
          >
            <MicSelector defaultValue="default">
              <MicSelectorTrigger>
                <MicSelectorValue />
              </MicSelectorTrigger>
              <MicSelectorContent>
                <MicSelectorInput />
              </MicSelectorContent>
            </MicSelector>
          </ClientOnly>
        </Card>

        <Card title="Speech Input" note="push-to-talk transcription button">
          <ClientOnly
            fallback={<p className="text-muted-foreground text-xs">Loading speech input…</p>}
          >
            <SpeechInput
              onTranscriptionChange={() => {}}
              onAudioRecorded={async () => 'demo transcription'}
              lang="en-US"
              title="Click to speak"
            />
          </ClientOnly>
        </Card>

        <Card title="Transcription" note="time-aligned segments">
          <Transcription
            segments={[
              { startSecond: 0, endSecond: 2, text: 'Hello,' },
              { startSecond: 2, endSecond: 4, text: 'how can' },
              { startSecond: 4, endSecond: 6, text: 'I help?' },
            ]}
            currentTime={3}
          >
            {(segment, index) => (
              <TranscriptionSegment key={index} segment={segment} index={index} />
            )}
          </Transcription>
        </Card>

        <Card title="Voice Selector" note="pick a TTS voice">
          <ClientOnly
            fallback={<p className="text-muted-foreground text-xs">Loading voice selector…</p>}
          >
            <VoiceSelector defaultValue="voice-1">
              <VoiceSelectorTrigger>Select voice</VoiceSelectorTrigger>
              <VoiceSelectorContent>
                <VoiceSelectorInput placeholder="Search voices…" />
                <VoiceSelectorList>
                  <VoiceSelectorGroup heading="Featured">
                    <VoiceSelectorItem value="voice-1">
                      <VoiceSelectorName>Alex</VoiceSelectorName>
                      <VoiceSelectorAttributes>
                        <VoiceSelectorGender value="male" />
                        <VoiceSelectorBullet />
                        <VoiceSelectorAccent value="american" />
                      </VoiceSelectorAttributes>
                    </VoiceSelectorItem>
                  </VoiceSelectorGroup>
                </VoiceSelectorList>
              </VoiceSelectorContent>
            </VoiceSelector>
          </ClientOnly>
        </Card>

        <Card title="Persona" note="animated voice avatar (Rive WebGL2)">
          <ClientOnly fallback={<p className="text-muted-foreground text-xs">Loading persona…</p>}>
            <div className="flex gap-6">
              <Persona variant="obsidian" state="idle" />
              <Persona variant="glint" state="listening" />
            </div>
          </ClientOnly>
        </Card>
      </Category>

      {/* --------------------------------------------------------------- Workflow */}
      <Category title="Workflow">
        <Card title="Chain of Thought" note="stepped reasoning trace">
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Planning the response</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep label="Parse the request" status="complete" />
              <ChainOfThoughtStep label="Search the docs" status="complete">
                <ChainOfThoughtSearchResults>
                  <ChainOfThoughtSearchResult>mastra memory</ChainOfThoughtSearchResult>
                  <ChainOfThoughtSearchResult>semantic recall</ChainOfThoughtSearchResult>
                </ChainOfThoughtSearchResults>
              </ChainOfThoughtStep>
              <ChainOfThoughtStep label="Call getWeather" status="active" />
              <ChainOfThoughtStep label="Compose the answer" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        </Card>

        <Card title="Plan" note="plan-then-execute card (streaming, with action + footer)">
          <Plan isStreaming>
            <PlanHeader>
              <PlanTitle>Build the Showroom</PlanTitle>
              <PlanDescription>Render every element with example props.</PlanDescription>
              <PlanAction>
                <Suggestion suggestion="Run" onClick={() => {}} />
              </PlanAction>
            </PlanHeader>
            <PlanContent>
              <p className="text-muted-foreground text-sm">
                1. Gather APIs → 2. Render → 3. Verify
              </p>
            </PlanContent>
            <PlanFooter>
              <span className="text-muted-foreground text-xs">Step 2 of 3 · generating…</span>
            </PlanFooter>
          </Plan>
        </Card>

        <Card title="Checkpoint" note="conversation restore point">
          <Checkpoint>
            <CheckpointTrigger tooltip="Restore to this point">
              Restore checkpoint
            </CheckpointTrigger>
          </Checkpoint>
        </Card>

        <Card
          title="Canvas + Node + Edge + Connection + Controls + Panel + Toolbar"
          note="ReactFlow workflow graph"
          wide
        >
          <ClientOnly fallback={<p className="text-muted-foreground text-xs">Loading canvas…</p>}>
            <ShowcaseCanvas />
          </ClientOnly>
        </Card>
      </Category>

      {/* -------------------------------------------------------------- Utilities */}
      <Category title="Utilities">
        <Card title="Attachments" note="file/image chips with preview + remove">
          <Attachments variant="inline">
            <Attachment
              data={{
                id: 'a1',
                type: 'file',
                mediaType: 'image/png',
                filename: 'diagram.png',
                url: TINY_PNG,
              }}
              onRemove={() => {}}
            >
              <AttachmentPreview />
              <AttachmentRemove />
            </Attachment>
          </Attachments>
        </Card>

        <Card title="Conversation Download" note="export the thread to markdown">
          <ConversationDownload messages={DOWNLOAD_MESSAGES} filename="chat.md">
            Download conversation
          </ConversationDownload>
        </Card>

        <Card title="Model Selector" note="searchable model command palette">
          <ModelSelector>
            <ModelSelectorTrigger>Claude Sonnet 4.6</ModelSelectorTrigger>
            <ModelSelectorContent title="Choose a model">
              <ModelSelectorInput placeholder="Search models…" />
              <ModelSelectorList>
                <ModelSelectorGroup heading="Anthropic">
                  <ModelSelectorItem value="anthropic/claude-sonnet-4-6">
                    <ModelSelectorName>Claude Sonnet 4.6</ModelSelectorName>
                  </ModelSelectorItem>
                  <ModelSelectorItem value="anthropic/claude-opus-4-8">
                    <ModelSelectorName>Claude Opus 4.8</ModelSelectorName>
                  </ModelSelectorItem>
                </ModelSelectorGroup>
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>
        </Card>
      </Category>

      <p className="mt-10 text-muted-foreground text-xs">
        48/48 element modules rendered. Browser-only widgets (audio player, mic/voice selectors,
        persona, canvas) are gated to a live browser and may show a fallback in headless tests.
      </p>
    </main>
  );
}

const SHOWROOM_MODELS = [
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'anthropic/claude-opus-4-8', name: 'Claude Opus 4.8' },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5' },
];

/** Renders attachment chips above the textarea (reads the prompt-input context). */
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

/** The full PromptInput, statefully self-contained for the gallery. */
function ShowroomPromptInput() {
  const [text, setText] = useState('');
  const [model, setModel] = useState(SHOWROOM_MODELS[0].id);
  const [web, setWeb] = useState(false);
  return (
    <PromptInput onSubmit={() => setText('')} globalDrop multiple>
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
            onClick={() => setWeb((v) => !v)}
            tooltip={{ content: 'Search the web', shortcut: '⌘K' }}
            variant={web ? 'default' : 'ghost'}
          >
            <GlobeIcon className="size-4" />
            <span>Search</span>
          </PromptInputButton>
          <PromptInputSelect onValueChange={setModel} value={model}>
            <PromptInputSelectTrigger>
              <PromptInputSelectValue />
            </PromptInputSelectTrigger>
            <PromptInputSelectContent>
              {SHOWROOM_MODELS.map((mo) => (
                <PromptInputSelectItem key={mo.id} value={mo.id}>
                  {mo.name}
                </PromptInputSelectItem>
              ))}
            </PromptInputSelectContent>
          </PromptInputSelect>
        </PromptInputTools>
        <PromptInputSubmit status="ready" />
      </PromptInputFooter>
    </PromptInput>
  );
}
