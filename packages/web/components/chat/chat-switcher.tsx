'use client';

import { PanelLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Chat } from '@/components/chat/chat';
import { ChatSidebar } from '@/components/chat/chat-sidebar';
import { HarnessChat } from '@/components/chat/harness-chat';
import { cn } from '@/lib/utils';

type Engine = 'single' | 'harness' | 'code';

const ENGINES: { id: Engine; label: string }[] = [
  { id: 'single', label: 'Single Agent' },
  { id: 'harness', label: 'Agent Harness' },
  { id: 'code', label: 'Code Agent' },
];

/**
 * The chat app shell. Owns the persistent chat-history sidebar (Mastra threads
 * for the Single Agent), the engine toggle, and the cross-cutting state the two
 * need to share: the active `threadId`, sidebar collapse, and a `listVersion`
 * counter the Chat bumps after each turn so the sidebar re-fetches.
 *
 * The sidebar is the Single Agent's history: selecting a chat (or "New chat")
 * snaps the engine to `single` and loads/clears that thread. Harness and Code
 * keep their current behavior (no persisted thread wiring in this pass).
 */
export function ChatSwitcher() {
  const [engine, setEngine] = useState<Engine>('single');
  const [threadId, setThreadId] = useState<string | null>(null);
  // Whether the active thread was freshly minted (eligible for AI title-gen)
  // vs. selected from history (already titled, must not be regenerated/cleared).
  const [threadIsNew, setThreadIsNew] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [listVersion, setListVersion] = useState(0);

  // Lazily mint the first thread id on the client (avoids an SSR/CSR mismatch
  // from generating a uuid during render).
  useEffect(() => {
    setThreadId((id) => id ?? crypto.randomUUID());
  }, []);

  const refreshList = useCallback(() => setListVersion((v) => v + 1), []);

  const newChat = useCallback(() => {
    setThreadId(crypto.randomUUID());
    setThreadIsNew(true);
    setEngine('single');
  }, []);

  const selectChat = useCallback((id: string) => {
    setThreadId(id);
    setThreadIsNew(false);
    setEngine('single');
  }, []);

  return (
    <div className="flex h-full flex-1">
      <ChatSidebar
        activeThreadId={engine === 'single' ? threadId : null}
        onSelect={selectChat}
        onNew={newChat}
        refreshSignal={listVersion}
        collapsed={collapsed}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex items-center justify-center gap-1 border-border border-b p-2">
          <button
            type="button"
            aria-label={collapsed ? 'Show chat history' : 'Hide chat history'}
            onClick={() => setCollapsed((v) => !v)}
            className="absolute left-2 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-[scale,color] hover:text-foreground active:scale-[0.96]"
          >
            <PanelLeftIcon className="size-4" />
          </button>

          <div className="inline-flex rounded-lg bg-muted p-0.5">
            {ENGINES.map((e) => (
              <button
                type="button"
                key={e.id}
                onClick={() => setEngine(e.id)}
                className={cn(
                  'rounded-md px-3 py-1 font-medium text-sm transition active:scale-[0.96]',
                  engine === e.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {e.label}
              </button>
            ))}
          </div>
          <nav className="absolute right-3 flex items-center gap-3 text-sm">
            <Link href="/showcase" className="text-muted-foreground hover:text-foreground">
              Showroom
            </Link>
            <Link href="/status" className="text-muted-foreground hover:text-foreground">
              Status
            </Link>
          </nav>
        </div>

        {/* Single Agent keeps its persisted thread mounted across engine switches
            so its history/state survive a peek at Harness or Code. */}
        <div className={cn('flex min-h-0 flex-1 flex-col', engine !== 'single' && 'hidden')}>
          <Chat
            agentId="chat"
            threadId={threadId ?? undefined}
            threadIsNew={threadIsNew}
            onActivity={refreshList}
          />
        </div>
        {engine === 'harness' && <HarnessChat />}
        {engine === 'code' && <Chat agentId="code" />}
      </div>
    </div>
  );
}
