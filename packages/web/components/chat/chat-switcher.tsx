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
  const [rightCollapsed, setRightCollapsed] = useState(false);
  // One harness session, shared by the sidebar, the chat, and the workbench panel
  // — so conversation history, the transcript, and the panel's Terminal/Files/
  // Browser all reflect the same session.
  const harness = useHarnessChat();

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-border border-b p-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={leftCollapsed ? 'Show conversations' : 'Hide conversations'}
            aria-pressed={!leftCollapsed}
            onClick={() => setLeftCollapsed((v) => !v)}
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-[scale,color] hover:text-foreground active:scale-[0.96] aria-pressed:text-foreground"
          >
            <PanelLeftIcon className="size-4" />
          </button>
          <span className="pl-1 font-medium text-sm">mastra-chat-kit</span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/showcase" className="text-muted-foreground hover:text-foreground">
            Showroom
          </Link>
          <Link href="/status" className="text-muted-foreground hover:text-foreground">
            Status
          </Link>
          <button
            type="button"
            aria-label={rightCollapsed ? 'Show workbench panel' : 'Hide workbench panel'}
            aria-pressed={!rightCollapsed}
            onClick={() => setRightCollapsed((v) => !v)}
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-[scale,color] hover:text-foreground active:scale-[0.96] aria-pressed:text-foreground"
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
        <HarnessChat harness={harness} fluid={!rightCollapsed} />
        {!rightCollapsed && <WorkbenchPanel harness={harness} />}
      </div>
    </div>
  );
}
