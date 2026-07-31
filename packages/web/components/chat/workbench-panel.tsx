'use client';

import {
  BrainIcon,
  CalendarClockIcon,
  FilesIcon,
  GlobeIcon,
  PanelRightCloseIcon,
  TerminalIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Terminal } from '@/components/ai-elements/terminal';
import { WorkbenchBrowser } from '@/components/chat/workbench-browser';
import { WorkbenchFiles } from '@/components/chat/workbench-files';
import { WorkbenchMemory } from '@/components/chat/workbench-memory';
import { WorkbenchSchedules } from '@/components/chat/workbench-schedules';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AgentControllerWorkspace } from '@/lib/agent-controller/events';
import type { UseAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';
import { cn } from '@/lib/utils';

/**
 * The agent workbench — a collapsible right panel that surfaces what the controller
 * agent's Workspace is doing, on three tabs:
 *
 * - **Files** — the agent's filesystem (P3.3: served from `WORKSPACE_ROOT`).
 * - **Terminal** — live shell stdout/stderr, accumulated from `shell_output`.
 * - **Browser** — a live screencast of the agent's Chrome (P3.4: `startScreencast`).
 *
 * It shares the single controller session with `<AgentControllerChat>` (the hook is lifted to
 * the shell), so the panel reflects the same run the user is chatting with.
 */
export function WorkbenchPanel({
  controller,
  onCollapse,
}: {
  controller: UseAgentControllerChat;
  onCollapse?: () => void;
}) {
  const { terminal, workspace, memory } = controller.transcript;
  const { schedules } = controller;

  return (
    // Flush to the window edge — the right rail is part of the recessed frame; the chat
    // floats inset between the two rails (see ChatSwitcher).
    <div className="flex min-h-0 w-[26rem] shrink-0 flex-col bg-sidebar">
      <Tabs defaultValue="files" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList
          variant="line"
          className="w-full justify-start gap-1 rounded-none border-border border-b px-2 py-1"
        >
          <TabsTrigger value="files">
            <FilesIcon />
            Files
          </TabsTrigger>
          <TabsTrigger value="terminal">
            <TerminalIcon />
            Terminal
          </TabsTrigger>
          <TabsTrigger value="browser">
            <GlobeIcon />
            Browser
          </TabsTrigger>
          <TabsTrigger value="memory">
            <BrainIcon />
            Memory
          </TabsTrigger>
          <TabsTrigger value="schedules">
            <CalendarClockIcon />
            Schedules
          </TabsTrigger>
          {/* Workspace status dot — reflects the controller workspace lifecycle. */}
          <WorkspaceStatus workspace={workspace} className="ml-auto self-center" />
          {/* Collapse control lives in the panel header (not floating over it). */}
          <button
            type="button"
            aria-label="Hide workbench"
            onClick={onCollapse}
            className="flex size-7 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <PanelRightCloseIcon className="size-4" />
          </button>
        </TabsList>

        <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden p-3">
          <WorkbenchFiles controller={controller} />
        </TabsContent>
        <TabsContent value="terminal" className="min-h-0 flex-1 overflow-auto p-4">
          {terminal.output ? (
            <Terminal
              output={terminal.output}
              isStreaming={terminal.running}
              onClear={controller.clearTerminal}
            />
          ) : (
            <PanelPlaceholder>
              Shell output streams here when the agent runs a command.
            </PanelPlaceholder>
          )}
        </TabsContent>
        <TabsContent value="browser" className="min-h-0 flex-1 overflow-hidden p-3">
          <WorkbenchBrowser />
        </TabsContent>
        <TabsContent value="memory" className="min-h-0 flex-1 overflow-hidden p-3">
          <WorkbenchMemory memory={memory} />
        </TabsContent>
        <TabsContent value="schedules" className="min-h-0 flex-1 overflow-hidden p-3">
          <WorkbenchSchedules schedules={schedules} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * A compact status dot + label for the workspace lifecycle. Green when the
 * agent's workspace is live, red on error, amber (pulsing) while it initializes.
 * Renders nothing until the workspace first reports in, so an idle panel stays quiet.
 */
function WorkspaceStatus({
  workspace,
  className,
}: {
  workspace: AgentControllerWorkspace | null;
  className?: string;
}) {
  if (!workspace) {
    return null;
  }
  const isReady = workspace.status === 'ready';
  const isError = workspace.status === 'error';
  const dot = isReady
    ? 'bg-emerald-500'
    : isError
      ? 'bg-destructive'
      : 'bg-amber-500 animate-pulse';
  const label = isReady ? 'Ready' : isError ? 'Error' : workspace.status;
  return (
    <span
      className={cn('flex items-center gap-1.5 text-muted-foreground text-xs', className)}
      title={workspace.error ?? `Workspace ${workspace.status}`}
    >
      <span className={cn('size-1.5 rounded-full', dot)} />
      <span className="capitalize">{label}</span>
    </span>
  );
}

function PanelPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}
