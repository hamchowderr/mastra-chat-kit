'use client';

import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import { useState } from 'react';
import { AgentControllerChat, type ChatOptions } from '@/components/chat/agent-controller-chat';
import { AgentControllerSidebar } from '@/components/chat/agent-controller-sidebar';
import {
  WORKBENCH_TABS,
  WorkbenchPanel,
  type WorkbenchTab,
} from '@/components/chat/workbench-panel';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  type AgentControllerToolEnd,
  useAgentControllerChat,
} from '@/lib/agent-controller/use-agent-controller-chat';
import { cn } from '@/lib/utils';

export type ChatSwitcherProps = ChatOptions & {
  /**
   * Classes for the shell's root. It fills the whole screen (`h-dvh`) by default; inside
   * a host layout, pass the height it should take instead, e.g. `h-full`.
   */
  className?: string;
  /** Which workbench tabs to show. `[]` removes the workbench and its toggle. */
  workbenchTabs?: readonly WorkbenchTab[];
  /** Called when the agent finishes a tool call (e.g. refresh the host page after a write). */
  onToolEnd?: (tool: AgentControllerToolEnd) => void;
};

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
export function ChatSwitcher({
  className,
  workbenchTabs = WORKBENCH_TABS,
  onToolEnd,
  ...options
}: ChatSwitcherProps = {}) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // Workbench starts CLOSED so the default view is a clean chat, not an IDE.
  const [rightCollapsed, setRightCollapsed] = useState(true);
  // Phones: the conversations list opens over the chat as a sheet, closed by default.
  const isMobile = useIsMobile();
  const [listOpen, setListOpen] = useState(false);
  const controller = useAgentControllerChat({ onToolEnd });

  // New chat: clear the transcript, then focus the composer so it's obviously
  // responsive — from an already-empty chat there'd otherwise be no visible change.
  const handleNew = () => {
    setListOpen(false);
    controller.reset();
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>('textarea[data-slot="input-group-control"]')
        ?.focus();
    });
  };
  const handleSelect = (threadId: string) => {
    setListOpen(false);
    controller.openThread(threadId);
  };
  const sidebar = (collapsed: boolean, onToggleCollapse: () => void, fill = false) => (
    <AgentControllerSidebar
      activeThreadId={controller.activeThreadId}
      onSelect={handleSelect}
      onNew={handleNew}
      refreshSignal={controller.refreshSignal}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      fill={fill}
    />
  );
  const workbenchOpen = !rightCollapsed && workbenchTabs.length > 0;

  return (
    // Recessed frame: the shell + both rails share the sidebar tone; the chat floats inset
    // as a raised rounded panel (the "inset" layout — clean, subtle separation).
    <div className={cn('relative flex h-dvh overflow-hidden bg-sidebar', className)}>
      {/* Below md the inline rail is hidden by CSS (no flash before the phone check runs)
          and the list opens as a sheet instead. */}
      <div className="contents max-md:hidden">
        {sidebar(leftCollapsed, () => setLeftCollapsed((v) => !v))}
      </div>
      {isMobile && (
        <Sheet open={listOpen} onOpenChange={setListOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            aria-describedby={undefined}
            className="gap-0 border-r-0 bg-sidebar p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          >
            <SheetTitle className="sr-only">Conversations</SheetTitle>
            {/* The list fills the sheet, whose width the host's Sheet sets. */}
            {sidebar(false, () => setListOpen(false), true)}
          </SheetContent>
        </Sheet>
      )}

      {/* Collapsed (or on a phone) → a floating control brings the conversations back
          (same spot as the in-sidebar toggle, so it appears to stay put). */}
      <button
        type="button"
        aria-label="Show conversations"
        onClick={() => (isMobile ? setListOpen(true) : setLeftCollapsed(false))}
        className={cn(
          'absolute top-2.5 left-2.5 z-20 flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.96]',
          !leftCollapsed && 'md:hidden',
        )}
      >
        <PanelLeftIcon className="size-4" />
      </button>

      <div className="relative flex min-h-0 min-w-0 flex-1">
        {/* The chat is the raised, floating panel: inset margin + rounded + border + soft
            shadow, over the recessed sidebar-tone frame. */}
        <div className="m-1.5 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <AgentControllerChat controller={controller} options={options} />
        </div>

        {/* Only when the panel is CLOSED does the toggle float in the chat's empty
            top-right gutter — open, it would overlap the panel, so the collapse
            control lives in the panel's own header instead. */}
        {rightCollapsed && workbenchTabs.length > 0 && (
          <button
            type="button"
            aria-label="Show workbench"
            onClick={() => setRightCollapsed(false)}
            className="absolute top-2.5 right-2.5 z-20 flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.96]"
          >
            <PanelRightIcon className="size-4" />
          </button>
        )}

        {workbenchOpen && !isMobile && (
          <WorkbenchPanel
            controller={controller}
            tabs={workbenchTabs}
            onCollapse={() => setRightCollapsed(true)}
          />
        )}
      </div>

      {/* Phones: the workbench opens over the chat as a sheet, full width. */}
      {isMobile && (
        <Sheet open={workbenchOpen} onOpenChange={(open) => setRightCollapsed(!open)}>
          <SheetContent
            side="right"
            showCloseButton={false}
            aria-describedby={undefined}
            className="w-full gap-0 border-l-0 bg-sidebar p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-[26rem]"
          >
            <SheetTitle className="sr-only">Workbench</SheetTitle>
            <WorkbenchPanel
              controller={controller}
              tabs={workbenchTabs}
              onCollapse={() => setRightCollapsed(true)}
              className="min-h-0 w-full flex-1"
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
