import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Component test tier — jsdom + React Testing Library. No DB, no API, no AIMock.
 * Each AI Element is rendered with crafted props/parts and asserted. This is the
 * "a test for each element" layer.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(dir, '.') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: true,
    // Heavy element modules (@xyflow, motion, media-chrome, shiki) are slow to
    // transform on first import; generous timeout keeps the smoke test honest.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
