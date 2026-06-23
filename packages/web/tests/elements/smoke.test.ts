import { describe, expect, it } from 'vitest';

/**
 * Import-smoke across EVERY installed AI Element module. Catches the most common
 * breakage class — a component, dependency, or shadcn/config mismatch that stops
 * a module from importing — across all 48 modules at once. `import.meta.glob`
 * (vite) discovers them so this stays correct as elements are added/removed.
 */
const modules = import.meta.glob('../../components/ai-elements/*.tsx');

describe('AI Elements — every module imports and exports a component', () => {
  const entries = Object.entries(modules);

  it('discovers all installed element modules', () => {
    expect(entries.length).toBeGreaterThanOrEqual(40);
  });

  for (const [filePath, load] of entries) {
    const name = filePath.split('/').pop()?.replace('.tsx', '') ?? filePath;
    it(`${name} imports without throwing and exposes exports`, async () => {
      // The load() resolving at all is the core signal: the module — and its
      // whole dependency/shadcn-config graph — imports cleanly. Then assert it
      // actually exports something (component fn, forwardRef/memo object, or a
      // namespace object like edge.tsx's `Edge` map).
      const mod = (await load()) as Record<string, unknown>;
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });
  }
});
