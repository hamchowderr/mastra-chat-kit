import type { NextConfig } from 'next';

// Strict type-checking is enforced on build. The vendored AI Elements'
// radix namespace-alias `{}` collapse was caused by a duplicate @types/react
// in the pnpm tree (18.x alongside 19.x); a workspace `@types/react` override
// (root package.json `pnpm.overrides`) dedupes it, and `tsc --noEmit` is clean.
const nextConfig: NextConfig = {};

export default nextConfig;
