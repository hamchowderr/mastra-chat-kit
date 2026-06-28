import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Repo root (parent of packages/web and the pnpm store). Turbopack won't resolve
// files outside its root, and pnpm symlinks `next` into packages/web/node_modules
// pointing at <repo>/node_modules/.pnpm — so the root must encompass both.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Strict type-checking is enforced on build. The vendored AI Elements'
// radix namespace-alias `{}` collapse was caused by a duplicate @types/react
// in the pnpm tree (18.x alongside 19.x); a workspace `@types/react` override
// (root package.json `pnpm.overrides`) dedupes it, and `tsc --noEmit` is clean.
const nextConfig: NextConfig = {
  // Pin Turbopack's root to the monorepo root so it follows the pnpm symlink for
  // `next` (and other deps) into the store. Inference was failing the build under
  // `vercel build` / `next build`.
  turbopack: { root: repoRoot },
};

export default nextConfig;
