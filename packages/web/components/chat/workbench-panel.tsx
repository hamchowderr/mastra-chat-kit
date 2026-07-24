'use client';

import { FilesIcon, GlobeIcon, TerminalIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * The agent workbench — a collapsible right panel that surfaces what the harness
 * agent's Workspace is doing, on three tabs:
 *
 * - **Files** — the agent's filesystem (P3.3: served from `WORKSPACE_ROOT`).
 * - **Terminal** — live shell stdout/stderr (P3.2: the `shell_output` stream).
 * - **Browser** — a live screencast of the agent's Chrome (P3.4: `startScreencast`).
 *
 * This is the shell: the tab bodies are placeholders until each panel is wired to
 * the harness in its own pass. The panel shares the single harness session with
 * `<HarnessChat>` (the hook is lifted to the shell when the panels consume it).
 */
export function WorkbenchPanel() {
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

        <TabsContent value="files" className="min-h-0 flex-1 overflow-auto p-4">
          <PanelPlaceholder>The agent's workspace files appear here.</PanelPlaceholder>
        </TabsContent>
        <TabsContent value="terminal" className="min-h-0 flex-1 overflow-auto p-4">
          <PanelPlaceholder>
            Shell output streams here when the agent runs a command.
          </PanelPlaceholder>
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
