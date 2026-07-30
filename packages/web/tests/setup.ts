import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom lacks browser APIs that several AI Elements depend on (Conversation's
// stick-to-bottom uses ResizeObserver; others use IntersectionObserver,
// matchMedia, scrollIntoView). Polyfill them so component renders don't throw.
class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver ??= MockObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= MockObserver as unknown as typeof IntersectionObserver;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

// jsdom has no MediaDevices; the mic selector's useAudioDevices hook calls
// enumerateDevices on mount. Stub it so browser-only voice elements don't throw
// in effects (which error boundaries can't catch) when a test renders them.
if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: () => Promise.resolve([]),
      getUserMedia: () => Promise.reject(new Error('no media in jsdom')),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
}

// Unmount React trees between tests so the jsdom DOM doesn't leak across cases.
afterEach(() => {
  cleanup();
});
