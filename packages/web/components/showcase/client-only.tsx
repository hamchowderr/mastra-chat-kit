'use client';

import { Component, type ReactNode, useEffect, useState } from 'react';

/**
 * Renders children only after the component has mounted in a real browser.
 * A handful of AI Elements need browser-only capabilities that jsdom/SSR can't
 * provide (Rive WebGL2, MediaDevices, media-chrome custom elements, ReactFlow
 * layout). Gating them here keeps the Showroom server-renderable and the jsdom
 * render test green, while the live browser still shows everything.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}

/**
 * A gallery shouldn't blank out because one WebGL/media widget throws. This
 * boundary isolates a single showcased element — if it fails to render, the
 * rest of the Showroom is unaffected.
 */
export class Safe extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <p className="text-muted-foreground text-xs">
          {this.props.label ?? 'This element'} needs a live browser capability and could not render
          here: {this.state.error.message}
        </p>
      );
    }
    return this.props.children;
  }
}
