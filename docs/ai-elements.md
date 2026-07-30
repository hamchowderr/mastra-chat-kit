# AI Elements Reference — vendored components (all 48)

> Source: `packages/web/components/ai-elements/*.tsx` — the Vercel AI Elements, **vendored**
> (shadcn-style: the source is copied into this repo, so we own and can edit every file).
> Built on `ai@7` / `@ai-sdk/react@4` + Radix/Base-UI primitives.

All 48 Vercel AI Elements are vendored so a real chat can compose any of them. The last column marks
whether the **reference app** currently drives the component with live data:
- **live** = imported by the real chat surface (`components/chat/*`, `components/workbench/*`) and fed
  by a real agent turn.
- **showroom** = vendored but not yet wired to a live surface in this kit (e.g. the voice and
  workflow-canvas families) — available to compose, just not exercised here.

For the authoritative, always-current "what's wired" view — every controller event → the element it
drives, with a copy-paste prompt to trigger it live — see the in-app **`/events`** page
(`packages/web/app/events/page.tsx`) and [agent-controller-events.md](./agent-controller-events.md).

Each file exports a root component plus several sub-parts (compound-component pattern). "Key props"
lists the meaningful props of the **root**; sub-parts are named for reference.

| # | file | exported parts | key props (root) | purpose | live? |
|---|---|---|---|---|---|
| 1 | agent.tsx | Agent, AgentHeader, AgentContent, AgentInstructions, AgentTools, AgentTool, AgentOutput | AgentHeader `name`,`model`; AgentTool `tool`; AgentOutput `schema` | Card describing an agent — name/model, instructions, tools, output schema | showroom |
| 2 | artifact.tsx | Artifact, ArtifactHeader, ArtifactClose, ArtifactTitle, ArtifactDescription, ArtifactActions, ArtifactAction, ArtifactContent | ArtifactAction `tooltip`,`label`,`icon` | Framed side-panel container for a generated artifact | showroom |
| 3 | attachments.tsx | Attachments, Attachment, AttachmentPreview, AttachmentInfo, AttachmentRemove, AttachmentHoverCard, AttachmentEmpty + hooks | Attachments `variant` (grid/inline/list); Attachment `data`,`onRemove` | Message/composer file attachments — preview, label, remove | **live** (composer) |
| 4 | audio-player.tsx | AudioPlayer(+Element,+ControlBar,+PlayButton,+Seek*,+Time*,+Mute,+Volume) | AudioPlayerElement `data`/`src` | Themed media-chrome audio player for TTS/speech | showroom |
| 5 | canvas.tsx | Canvas | ReactFlowProps + `children` | React Flow canvas wrapper for node/workflow graphs | showroom |
| 6 | chain-of-thought.tsx | ChainOfThought(+Header,+Step,+SearchResults,+SearchResult,+Content,+Image) | ChainOfThought `open`,`defaultOpen`,`onOpenChange`; Step `icon`,`label`,`description`,`status` | Collapsible reasoning-step timeline with search-result chips | **live** (tool-views) |
| 7 | checkpoint.tsx | Checkpoint, CheckpointIcon, CheckpointTrigger | CheckpointTrigger `tooltip` | Inline conversation checkpoint/bookmark divider | showroom |
| 8 | code-block.tsx | CodeBlock(+Container,+Header,+Title,+Filename,+Actions,+Content,+CopyButton,+LanguageSelector) | CodeBlock `code`,`language`,`showLineNumbers` | Shiki-highlighted code block with copy | **live** (tool-views, workbench-files) |
| 9 | commit.tsx | Commit(+Header,+Hash,+Message,+Metadata,+Author*,+Timestamp,+Files,+File*) | Commit Collapsible props; CommitFileStatus `status` | Expandable git-commit card with author + changed files | showroom |
| 10 | confirmation.tsx | Confirmation, ConfirmationTitle, ConfirmationRequest, ConfirmationAccepted, ConfirmationRejected, ConfirmationActions, ConfirmationAction | Confirmation `approval` (`{id,approved?,reason?}`), `state` | Human-in-the-loop tool approval prompt (accept/reject) | **live** (agent-controller-chat) |
| 11 | connection.tsx | Connection | xyflow ConnectionLineComponent | Bezier drag-connection line for the canvas | showroom |
| 12 | context.tsx | Context(+Trigger,+Content*,+InputUsage,+OutputUsage,+ReasoningUsage,+CacheUsage) | Context `usedTokens`,`maxTokens`,`usage`,`modelId` | Token-budget dial + hover-card cost breakdown | **live** (chat, agent-controller-chat) |
| 13 | controls.tsx | Controls | xyflow Controls props | Styled zoom/fit controls for the canvas | showroom |
| 14 | conversation.tsx | Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton, ConversationDownload + messagesToMarkdown | Conversation StickToBottom props; EmptyState `title`,`description`,`icon` | Stick-to-bottom message list + empty state + markdown export | **live** (chat, agent-controller-chat) |
| 15 | edge.tsx | Edge (`Edge.Animated`, `Edge.Temporary`) | xyflow EdgeProps | Animated / dashed graph edges for the canvas | showroom |
| 16 | environment-variables.tsx | EnvironmentVariables(+Header,+Title,+Toggle,+Content,+Group,+Name,+Value,+CopyButton,+Required) | EnvironmentVariables `showValues`,`onShowValuesChange`; EnvironmentVariable `name`,`value` | Env-var list with masked values + reveal + copy | showroom |
| 17 | file-tree.tsx | FileTree, FileTreeIcon, FileTreeName, FileTreeFolder, FileTreeFile, FileTreeActions | FileTree `expanded`,`selectedPath`,`onSelect`,`onExpandedChange` | Collapsible file/folder tree | **live** (tool-views, workbench-files) |
| 18 | image.tsx | Image | `base64`,`mediaType`,`uint8Array?`,`alt` | Renders a generated image from base64 (no raw bytes needed) | **live** (tool-views) |
| 19 | inline-citation.tsx | InlineCitation(+Text,+Card*,+Carousel*,+Source,+Quote) | CardTrigger `sources` (string[]); Source `title`,`url`,`description` | Inline citation badge with hover-card carousel of sources | **live** (tool-views) |
| 20 | jsx-preview.tsx | JSXPreview, JSXPreviewContent, JSXPreviewError + useJSXPreview | JSXPreview `jsx`,`isStreaming`,`components`,`bindings`,`onError` | Live-renders streamed JSX, auto-closing partial tags | showroom |
| 21 | message.tsx | Message, MessageContent, MessageActions, MessageAction, MessageBranch*, MessageResponse, MessageToolbar | Message `from` (role); MessageResponse Streamdown props | Chat bubble, action toolbar, branch switcher, markdown renderer | **live** (chat, agent-controller-chat, tool-views) |
| 22 | mic-selector.tsx | MicSelector(+Trigger,+Content,+Input,+List,+Empty,+Item,+Label,+Value) + useAudioDevices | MicSelector `value`,`onValueChange`,`open` | Combobox for picking an audio-input device | showroom |
| 23 | model-selector.tsx | ModelSelector(+Trigger,+Content,+Dialog,+Input,+List,+Group,+Item,+Logo,+Name) | ModelSelector Dialog props; Logo `provider` | Command-palette dialog for choosing a model | **live** (composer) |
| 24 | node.tsx | Node, NodeHeader, NodeTitle, NodeDescription, NodeAction, NodeContent, NodeFooter | Node `handles` (`{target,source}`) | Card-shaped React Flow node with handles | showroom |
| 25 | open-in-chat.tsx | OpenIn(+Content,+Item,+Label,+Trigger,+ChatGPT,+Claude,+v0,+Cursor,…) | OpenIn `query` | Re-open the current prompt in ChatGPT/Claude/v0/Cursor/… | showroom |
| 26 | package-info.tsx | PackageInfo(+Header,+Name,+ChangeType,+Version,+Description,+Content,+Dependencies,+Dependency) | PackageInfo `name`,`currentVersion`,`newVersion`,`changeType` | Package card: version bump + change severity + deps | showroom |
| 27 | panel.tsx | Panel | xyflow Panel props (`position`) | Floating overlay panel inside the canvas | showroom |
| 28 | persona.tsx | Persona + PersonaState | `state`,`variant`,`onLoad`,`onReady`,… | Animated Rive avatar orb reflecting agent state | showroom |
| 29 | plan.tsx | Plan, PlanHeader, PlanTitle, PlanDescription, PlanAction, PlanContent, PlanFooter, PlanTrigger | Plan `isStreaming` + Collapsible props | Collapsible plan card; title/description shimmer while streaming | **live** (tool-views) |
| 30 | prompt-input.tsx | PromptInput(+Body,+Textarea,+Header,+Footer,+Tools,+Button,+ActionMenu,+Submit,+Select,+Tabs,+Command,…) + hooks | PromptInput `onSubmit`,`accept`,`multiple`,`globalDrop`,`maxFiles`; Submit `status`,`onStop` | Full composer form — textarea, attachments, action menu, submit/stop | **live** (composer) |
| 31 | queue.tsx | Queue(+Item*,+List,+Section*) + types | QueueSectionLabel `count`,`label`,`icon`; QueueItemContent `completed` | Pending-message / todo queue panel with collapsible sections | **live** (chat, agent-controller-chat) |
| 32 | reasoning.tsx | Reasoning, ReasoningTrigger, ReasoningContent + useReasoning | Reasoning `isStreaming`,`open`,`defaultOpen`,`duration` | Collapsible thinking block; auto-opens while streaming | **live** (chat, agent-controller-chat) |
| 33 | sandbox.tsx | Sandbox(+Header,+Content,+Tabs*) | Sandbox Collapsible props; SandboxHeader `title`,`state` | Collapsible tabbed sandbox/code-execution surface | showroom |
| 34 | schema-display.tsx | SchemaDisplay(+Header,+Method,+Path,+Description,+Content,+Parameter*,+Request,+Response,+Body,+Example) | SchemaDisplay `method`,`path`,`parameters`,`requestBody`,`responseBody` | OpenAPI-style endpoint viewer | showroom |
| 35 | shimmer.tsx | Shimmer + TextShimmerProps | `children`,`as`,`duration`,`spread` | Animated gradient shimmer over text (loading/streaming) | **live** (chat, agent-controller-chat) |
| 36 | snippet.tsx | Snippet, SnippetAddon, SnippetText, SnippetInput, SnippetCopyButton | Snippet `code` | One-line copyable command/code snippet | showroom |
| 37 | sources.tsx | Sources, SourcesTrigger, SourcesContent, Source | SourcesTrigger `count`; Source `href`,`title` | Collapsible "used N sources" citation list | **live** (chat, tool-views) |
| 38 | speech-input.tsx | SpeechInput | `onTranscriptionChange`,`onAudioRecorded`,`lang` | Mic button (Web Speech API + MediaRecorder fallback) | showroom |
| 39 | stack-trace.tsx | StackTrace(+Header,+Error*,+Actions,+CopyButton,+ExpandButton,+Content,+Frames) | StackTrace `trace`,`onFilePathClick`; Frames `showInternalFrames` | Parses a raw stack trace into collapsible clickable frames | showroom |
| 40 | suggestion.tsx | Suggestions, Suggestion | Suggestion `suggestion`,`onClick` | Horizontally-scrolling clickable prompt-suggestion pills | **live** (chat) |
| 41 | task.tsx | Task, TaskTrigger, TaskContent, TaskItem, TaskItemFile | Task `defaultOpen`; TaskTrigger `title` | Collapsible agent task/step group with file chips | **live** (agent-controller-chat) |
| 42 | terminal.tsx | Terminal(+Header,+Title,+Status,+Actions,+CopyButton,+ClearButton,+Content) | Terminal `output`,`isStreaming`,`autoScroll`,`onClear` | ANSI-rendering terminal pane (auto-scroll, streaming caret) | **live** (tool-views, workbench-panel) |
| 43 | test-results.tsx | TestResults(+Header,+Duration,+Summary,+Progress,+Content,+Suite*,+Test*) | TestResults `summary`; TestSuite `name`,`status`; Test `name`,`status`,`duration` | Test-run report — pass/fail bar, suites, per-test errors | showroom |
| 44 | tool.tsx | Tool, ToolHeader, ToolContent, ToolInput, ToolOutput + getStatusBadge | ToolHeader `type`,`state`,`toolName`,`title`; ToolInput `input`; ToolOutput `output`,`errorText` | Collapsible tool-call card — status badge, params, result/error | **live** (chat, agent-controller-chat) |
| 45 | toolbar.tsx | Toolbar | xyflow NodeToolbar props | Floating per-node action toolbar on the canvas | showroom |
| 46 | transcription.tsx | Transcription, TranscriptionSegment | Transcription `segments`,`currentTime`,`onSeek` | Time-synced transcript, segments highlight + seek | showroom |
| 47 | voice-selector.tsx | VoiceSelector(+Trigger,+Content,+Dialog,+Input,+List,+Item,+Gender,+Accent,+Age,+Name,+Preview) | VoiceSelector `value`,`onValueChange`,`open` | Command dialog for picking a TTS voice + preview | showroom |
| 48 | web-preview.tsx | WebPreview, WebPreviewNavigation, WebPreviewNavigationButton, WebPreviewUrl, WebPreviewBody, WebPreviewConsole | WebPreview `defaultUrl`,`onUrlChange`; Body `loading`,`src`; Console `logs` | Sandboxed iframe browser preview with URL bar + console | **live** (chat) |

## Live (22)
attachments · chain-of-thought · code-block · confirmation · context · conversation · file-tree ·
image · inline-citation · message · model-selector · plan · prompt-input · queue · reasoning ·
shimmer · sources · suggestion · task · terminal · tool · web-preview

## Showroom-only (26)
agent · artifact · audio-player · canvas · checkpoint · commit · connection · controls · edge ·
environment-variables · jsx-preview · mic-selector · node · open-in-chat · package-info · panel ·
persona · sandbox · schema-display · snippet · speech-input · stack-trace · test-results · toolbar ·
transcription · voice-selector

### Notes
- The **seven canvas components** (canvas, connection, controls, edge, node, panel, toolbar) are
  React-Flow/xyflow building blocks — they need a workflow-graph surface, not a chat one.
- The **voice/audio cluster** (audio-player, mic-selector, speech-input, voice-selector,
  transcription, persona) needs a voice pipeline before it can go live.
- High-value showroom → live candidates driven by controller events: **`agent`** (subagent events),
  **`sandbox`** (shell/code execution), **`stack-trace`** + **`test-results`** (structured tool
  output), **`checkpoint`** (thread snapshots). See [agent-controller-events.md](./agent-controller-events.md).
