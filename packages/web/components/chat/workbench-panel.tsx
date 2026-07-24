'use client';

import { FilesIcon, GlobeIcon, TerminalIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Terminal } from '@/components/ai-elements/terminal';
import { WorkbenchFiles } from '@/components/chat/workbench-files';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { UseHarnessChat } from '@/lib/harness/use-harness-chat';

/**
 * The agent workbench — a collapsible right panel that surfaces what the harness
 * agent's Workspace is doing, on three tabs:
 *
 * - **Files** — the agent's filesystem (P3.3: served from `WORKSPACE_ROOT`).
 * - **Terminal** — live shell stdout/stderr, accumulated from `shell_output`.
 * - **Browser** — a live screencast of the agent's Chrome (P3.4: `startScreencast`).
 *
 * It shares the single harness session with `<HarnessChat>` (the hook is lifted to
 * the shell), so the panel reflects the same run the user is chatting with.
 */
export function WorkbenchPanel({ harness }: { harness: UseHarnessChat }) {
  const { terminal } = harness.transcript;

  return (
    <div className="flex min-h-0 w-[26rem] shrink-0 flex-col border-border border-l bg-background">
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
        </TabsList>

        <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden p-3">
          <WorkbenchFiles harness={harness} />
        </TabsContent>
        <TabsContent value="terminal" className="min-h-0 flex-1 overflow-auto p-4">
          {terminal.output ? (
            <Terminal
              output={terminal.output}
              isStreaming={terminal.running}
              onClear={harness.clearTerminal}
            />
          ) : (
            <PanelPlaceholder>
              Shell output streams here when the agent runs a command.
            </PanelPlaceholder>
          )}
        </TabsContent>
        <TabsContent value="browser" className="min-h-0 flex-1 overflow-auto p-4">
          <PanelPlaceholder>A live view of the agent's browser appears here.</PanelPlaceholder>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PanelPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}
