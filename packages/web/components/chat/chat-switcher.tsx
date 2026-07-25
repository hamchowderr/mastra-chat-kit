'use client';

import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import { useState } from 'react';
import { HarnessChat } from '@/components/chat/harness-chat';
import { HarnessSidebar } from '@/components/chat/harness-sidebar';
import { WorkbenchPanel } from '@/components/chat/workbench-panel';
import { useHarnessChat } from '@/lib/harness/use-harness-chat';

/**
 * The app shell — the batteries-included agent workbench.
 *
 * One harness agent (an `AgentController` with a real Workspace: filesystem +
 * shell sandbox + browser) is the whole app: `<HarnessChat>` is the primary
 * column, with a collapsible `<WorkbenchPanel>` (Files · Terminal · Browser) on
 * the right surfacing what that Workspace is doing.
 *
 * The old engine tabs (Single / Harness / Code) are gone — there's one agent now.
 * The Single-Agent chat + its history sidebar (`chat.tsx`, `chat-sidebar.tsx`)
 * still live in the repo but are unwired here; harness thread history is a
 * follow-up (see the P3.5 issue) since the harness manages its own threads.
 */
export function ChatSwitcher() {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // Workbench (Files/Terminal/Browser) starts CLOSED so the default view is a
  // clean chat + history, not an IDE. Open it from the header when you want to
  // watch the agent's tools.
  const [rightCollapsed, setRightCollapsed] = useState(true);
  // One harness session, shared by the sidebar, the chat, and the workbench panel
  // — so conversation history, the transcript, and the panel's Terminal/Files/
  // Browser all reflect the same session.
  const harness = useHarnessChat();

  return (
    // Flat, three-pane layout: a thin top bar, then sidebar │ chat │ workbench.
    // Each pane owns exactly one divider (border) so nothing nests or overlaps.
    // h-dvh pins a concrete height so the inner flex-1 panes actually fill.
    <div className="flex h-dvh flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={leftCollapsed ? 'Show conversations' : 'Hide conversations'}
            aria-pressed={!leftCollapsed}
            onClick={() => setLeftCollapsed((v) => !v)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[scale,color] hover:bg-sidebar-accent hover:text-foreground active:scale-[0.96] aria-pressed:text-foreground"
          >
            <PanelLeftIcon className="size-4" />
          </button>
          <span className="font-semibold text-sm tracking-tight">mastra-chat-kit</span>
        </div>
        <button
          type="button"
          aria-label={rightCollapsed ? 'Show workbench panel' : 'Hide workbench panel'}
          aria-pressed={!rightCollapsed}
          onClick={() => setRightCollapsed((v) => !v)}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[scale,color] hover:bg-sidebar-accent hover:text-foreground active:scale-[0.96] aria-pressed:text-foreground"
        >
          <PanelRightIcon className="size-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <HarnessSidebar
          activeThreadId={harness.activeThreadId}
          onSelect={harness.openThread}
          onNew={harness.reset}
          refreshSignal={harness.refreshSignal}
          collapsed={leftCollapsed}
        />
        <HarnessChat harness={harness} />
        {!rightCollapsed && <WorkbenchPanel harness={harness} />}
      </div>
    </div>
  );
}
