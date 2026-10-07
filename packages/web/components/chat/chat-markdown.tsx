'use client';

import Link from 'next/link';
import {
  type AnchorHTMLAttributes,
  createContext,
  type MouseEvent,
  memo,
  type ReactNode,
  useContext,
} from 'react';
import type { Components } from 'streamdown';
import { MessageResponse, type MessageResponseProps } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';

/**
 * # Links in the agent's replies
 *
 * Streamdown's link safety is on by default: every link becomes a button behind an
 * "Open external link?" dialog that `window.open`s it in a new tab. In a chat that sits
 * inside the host app that is wrong twice over: a link to one of the app's own pages
 * (`/grants/42`) never navigates in place, and in a phone sheet the dialog is portaled
 * outside the modal sheet, where it cannot be tapped.
 *
 * So replies render through ChatMarkdown, which turns link safety off and gives
 * Streamdown its own `a` (both documented Streamdown options):
 *
 * - an app link (a path, or a URL on this origin) is a Next.js `<Link>`: it navigates in
 *   place, and calls the host's `onNavigate` so a sheet showing the chat can close;
 * - an anchor on the page (`#notes`) stays a plain link;
 * - any other link opens in a new tab, with `rel="noopener noreferrer"`;
 * - a link still streaming in (Streamdown's `streamdown:incomplete-link`) is plain text.
 */

type ChatLinks = {
  /** Called when an app link in a reply is followed (e.g. to close a phone sheet). */
  onNavigate?: (href: string) => void;
};

const ChatLinkContext = createContext<ChatLinks>({});

/** Lets the links in the replies below call the host back when they navigate. */
export function ChatLinkProvider({ onNavigate, children }: ChatLinks & { children: ReactNode }) {
  return <ChatLinkContext.Provider value={{ onNavigate }}>{children}</ChatLinkContext.Provider>;
}

/** What Streamdown puts in `href` while a link is still streaming in. */
const INCOMPLETE = 'streamdown:incomplete-link';

/**
 * The in-app href for a link, or null when it leaves the app. A path (`/grants/42`,
 * `/people?tag=x`) is in-app, and so is an absolute URL on `origin`; a protocol-relative
 * `//host/…` is not.
 */
export function appHref(href: string, origin?: string): string | null {
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (!origin) return null;
  try {
    const url = new URL(href);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/** A plain left click, which the app handles; a modified one opens a tab as usual. */
function plainClick(event: MouseEvent) {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
}

const linkClass = 'wrap-anywhere font-medium text-primary underline';

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown };

/** Streamdown's `a`: see the module comment. */
export function ChatLink({
  href = '',
  children,
  className,
  node: _node,
  // Streamdown hands every link target="_blank" and its own rel: each case sets its own.
  target: _target,
  rel: _rel,
  ...rest
}: AnchorProps) {
  const { onNavigate } = useContext(ChatLinkContext);
  if (href === INCOMPLETE) {
    return (
      <span className={className} data-incomplete="true">
        {children}
      </span>
    );
  }
  if (href.startsWith('#')) {
    return (
      <a {...rest} href={href} className={cn(linkClass, className)} data-streamdown="link">
        {children}
      </a>
    );
  }
  const inApp = appHref(href, typeof window === 'undefined' ? undefined : window.location.origin);
  if (inApp !== null) {
    return (
      <Link
        {...rest}
        href={inApp}
        className={cn(linkClass, className)}
        data-streamdown="link"
        onClick={(event) => {
          if (plainClick(event)) onNavigate?.(inApp);
        }}
      >
        {children}
      </Link>
    );
  }
  return (
    <a
      {...rest}
      href={href}
      className={cn(linkClass, className)}
      data-streamdown="link"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

const components: Components = { a: ChatLink };
const linkSafety = { enabled: false };

/** An agent reply as Markdown, with ChatLink for its links (and no link-safety dialog). */
export const ChatMarkdown = memo(
  (props: MessageResponseProps) => (
    <MessageResponse
      linkSafety={linkSafety}
      {...props}
      components={{ ...components, ...props.components }}
    />
  ),
  (prev, next) => prev.children === next.children && prev.isAnimating === next.isAnimating,
);

ChatMarkdown.displayName = 'ChatMarkdown';
