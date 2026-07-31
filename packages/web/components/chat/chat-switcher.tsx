'use client';

import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import { useState } from 'react';
import { AgentControllerChat } from '@/components/chat/agent-controller-chat';
import { AgentControllerSidebar } from '@/components/chat/agent-controller-sidebar';
import { WorkbenchPanel } from '@/components/chat/workbench-panel';
import { useAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';

/**
 * The app shell — sidebar │ chat │ workbench, no top header bar so the chat runs
 * edge to edge. The sidebar-collapse control lives at the top of the sidebar (and
 * floats top-left when the sidebar is collapsed, so it's always reachable); the
 * workbench toggle floats in the chat's empty top-right gutter.
 *
 * One controller session (an `AgentController` with a real Workspace: filesystem +
 * shell sandbox + browser) backs all three panes, so history, transcript, and the
 * workbench's Files/Terminal/Browser reflect the same run.
 */
export function ChatSwitcher() {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // Workbench starts CLOSED so the default view is a clean chat, not an IDE.
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const controller = useAgentControllerChat();

  // New chat: clear the transcript, then focus the composer so it's obviously
  // responsive — from an already-empty chat there'd otherwise be no visible change.
  const handleNew = () => {
    controller.reset();
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>('textarea[data-slot="input-group-control"]')
        ?.focus();
    });
  };

  return (
    // Recessed frame: the shell + both rails share the sidebar tone; the chat floats inset
    // as a raised rounded panel (the "inset" layout — clean, subtle separation).
    <div className="relative flex h-dvh overflow-hidden bg-sidebar">
      <AgentControllerSidebar
        activeThreadId={controller.activeThreadId}
        onSelect={controller.openThread}
        onNew={handleNew}
        refreshSignal={controller.refreshSignal}
        collapsed={leftCollapsed}
        onToggleCollapse={() => setLeftCollapsed((v) => !v)}
      />

      {/* Collapsed → a floating control brings the sidebar back (same spot as the
          in-sidebar toggle, so it appears to stay put). */}
      {leftCollapsed && (
        <button
          type="button"
          aria-label="Show conversations"
          onClick={() => setLeftCollapsed(false)}
          className="absolute top-2.5 left-2.5 z-20 flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.96]"
        >
          <PanelLeftIcon className="size-4" />
        </button>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1">
        {/* The chat is the raised, floating panel: inset margin + rounded + border + soft
            shadow, over the recessed sidebar-tone frame. */}
        <div className="m-1.5 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <AgentControllerChat controller={controller} />
        </div>

        {/* Only when the panel is CLOSED does the toggle float in the chat's empty
            top-right gutter — open, it would overlap the panel, so the collapse
            control lives in the panel's own header instead. */}
        {rightCollapsed && (
          <button
            type="button"
            aria-label="Show workbench"
            onClick={() => setRightCollapsed(false)}
            className="absolute top-2.5 right-2.5 z-20 flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.96]"
          >
            <PanelRightIcon className="size-4" />
          </button>
        )}

        {!rightCollapsed && (
          <WorkbenchPanel controller={controller} onCollapse={() => setRightCollapsed(true)} />
        )}
      </div>
    </div>
  );
}
