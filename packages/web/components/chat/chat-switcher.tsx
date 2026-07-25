'use client';

import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import Link from 'next/link';
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
    // The whole canvas takes the brand-tinted background; the sidebar blends into
    // it and the chat/workbench float as one elevated card (the Foreman look).
    <div className="flex h-full flex-1 flex-col bg-background">
      <header className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={leftCollapsed ? 'Show conversations' : 'Hide conversations'}
            aria-pressed={!leftCollapsed}
            onClick={() => setLeftCollapsed((v) => !v)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[scale,color] hover:bg-sidebar-accent hover:text-foreground active:scale-[0.96] aria-pressed:text-foreground"
          >
            <PanelLeftIcon className="size-4" />
          </button>
          <span className="pl-1 font-semibold text-sm tracking-tight">mastra-chat-kit</span>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/showcase"
            className="rounded-md px-2.5 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            Showroom
          </Link>
          <Link
            href="/status"
            className="rounded-md px-2.5 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            Status
          </Link>
          <button
            type="button"
            aria-label={rightCollapsed ? 'Show workbench panel' : 'Hide workbench panel'}
            aria-pressed={!rightCollapsed}
            onClick={() => setRightCollapsed((v) => !v)}
            className="ml-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[scale,color] hover:bg-sidebar-accent hover:text-foreground active:scale-[0.96] aria-pressed:text-foreground"
          >
            <PanelRightIcon className="size-4" />
          </button>
        </nav>
      </header>

      <div className="flex min-h-0 flex-1">
        <HarnessSidebar
          activeThreadId={harness.activeThreadId}
          onSelect={harness.openThread}
          onNew={harness.reset}
          refreshSignal={harness.refreshSignal}
          collapsed={leftCollapsed}
        />
        {/* Floating card: chat (+ workbench) elevated off the tinted canvas. */}
        <div className="min-h-0 flex-1 p-3 pl-0">
          <div className="flex h-full overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-float)]">
            <HarnessChat harness={harness} fluid={!rightCollapsed} />
            {!rightCollapsed && <WorkbenchPanel harness={harness} />}
          </div>
        </div>
      </div>
    </div>
  );
}
