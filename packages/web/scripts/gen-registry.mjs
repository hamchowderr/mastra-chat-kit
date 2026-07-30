// Generates registry.json for the mastra-chat-kit shadcn registry by parsing the
// REAL imports of the files we ship, so the manifest can never drift from the code.
//
// Strategy (see bd mastra-chat-kit-slh): we DEPEND on Vercel's AI Elements
// registry for the untouched elements and ship only the few we must override —
// the 3 patched files (code-block SSR fix, image/context strict-TS fits) plus
// `tool` (unchanged file, but it imports code-block, so it must resolve to OUR
// code-block, not Vercel's). The headline `chat` block + a `chat-engine` lib
// round it out.
//
// Run from packages/web:  node scripts/gen-registry.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';

const WEB = process.cwd(); // packages/web
const REGISTRY_NAME = 'mastra-chat-kit';
const HOMEPAGE = 'https://mastra-chat-kit.vercel.app';
const UPSTREAM = (name) => `https://ai-sdk.dev/elements/api/registry/${name}.json`;

// AI Elements we ship ourselves (everything else comes from Vercel upstream).
const LOCAL_ELEMENTS = new Set(['code-block', 'image', 'context', 'tool']);

// Host-provided packages — never list as registry npm dependencies.
const HOST_PKGS = new Set(['react', 'react-dom', 'next']);

const toPosix = (p) => p.split('\\').join('/');
const elPath = (n) => `components/ai-elements/${n}.tsx`;

/** Absolute path -> "components/ai-elements/x" style key (no extension). */
function keyOf(absNoExt) {
  return toPosix(relative(WEB, absNoExt));
}

/** Parse every `from "..."` / `import "..."` specifier in a source file. */
function parseImports(absFile) {
  const src = readFileSync(absFile, 'utf8');
  const specs = new Set();
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) specs.add(m[1] ?? m[2]);
  return [...specs];
}

/** npm package name from a bare specifier (handles scopes + subpaths). */
function pkgName(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

/**
 * Classify the import graph of a set of files (relative-to-WEB paths) into the
 * pieces a registry item needs. Resolves both `@/` aliases and `./` relatives.
 */
function classify(relFiles) {
  const npm = new Set();
  const ui = new Set();
  const aeLocal = new Set();
  const aeUpstream = new Set();
  const lib = new Set();
  const ownKeys = new Set(relFiles.map((f) => keyOf(resolve(WEB, f).replace(/\.tsx?$/, ''))));

  const noteElement = (name) => {
    if (LOCAL_ELEMENTS.has(name)) aeLocal.add(name);
    else aeUpstream.add(name);
  };

  for (const rel of relFiles) {
    const abs = resolve(WEB, rel);
    for (const spec of parseImports(abs)) {
      let key = null;
      if (spec.startsWith('@/')) {
        key = spec.slice(2); // strip "@/"
      } else if (spec.startsWith('.')) {
        key = toPosix(relative(WEB, resolve(dirname(abs), spec)));
      } else {
        const pkg = pkgName(spec);
        if (!HOST_PKGS.has(pkg)) npm.add(pkg);
        continue;
      }
      if (ownKeys.has(key)) continue; // import within this same item
      if (key.startsWith('components/ai-elements/')) noteElement(posix.basename(key));
      else if (key.startsWith('components/ui/')) ui.add(posix.basename(key));
      else if (key === 'lib/utils') {
        /* cn() — shadcn init provides this; not a registry dep */
      } else if (key.startsWith('lib/')) lib.add('chat-engine');
      else if (key.startsWith('components/chat/')) {
        /* Sibling in the chat block. NOT assumed present — validate() below
           asserts it's actually shipped. Assuming it was the b5y bug. */
      }
    }
  }
  return {
    npm: [...npm].sort(),
    ui: [...ui].sort(),
    aeLocal: [...aeLocal].sort(),
    aeUpstream: [...aeUpstream].sort(),
    lib: [...lib],
  };
}

// Local siblings MUST be namespace-qualified (`@mastra-chat-kit/<name>`) so shadcn
// resolves them against THIS registry. Bare names resolve against the default
// shadcn registry (ui.shadcn.com) — verified: a bare sibling 404s there. Only
// genuine shadcn/ui primitives (button, dialog, …) stay bare. The consumer must
// map "@mastra-chat-kit" -> "<homepage>/r/{name}.json" in their components.json.
const NS = (name) => `@${REGISTRY_NAME}/${name}`;

/** Build registryDependencies: ui primitives (bare) + local siblings (namespaced) + lib (namespaced) + upstream (URL). */
function regDeps(c, selfName) {
  return [
    ...c.ui,
    ...c.aeLocal.filter((n) => n !== selfName).map(NS),
    ...c.lib.map(NS),
    ...c.aeUpstream.map(UPSTREAM),
  ];
}

const items = [];

// 1) The 4 vendored AI Elements (3 patched + tool rewired to our code-block).
const ELEMENT_TITLES = {
  'code-block': 'Code Block (SSR-safe)',
  image: 'Image',
  context: 'Context',
  tool: 'Tool',
};
const ELEMENT_DESCS = {
  'code-block':
    'AI Elements code block with an SSR hydration fix (mount-gated Shiki highlighting).',
  image: 'AI Elements image; renders from base64 (uint8Array optional).',
  context: 'AI Elements context/usage display (Partial usage type).',
  tool: 'AI Elements tool call display, wired to the local SSR-safe code block.',
};
for (const name of [...LOCAL_ELEMENTS]) {
  const file = elPath(name);
  const c = classify([file]);
  items.push({
    name,
    type: 'registry:component',
    title: ELEMENT_TITLES[name] ?? name,
    description: ELEMENT_DESCS[name] ?? `AI Elements ${name}.`,
    dependencies: c.npm,
    registryDependencies: regDeps(c, name),
    files: [{ path: file, type: 'registry:component', target: file }],
  });
}

// 2) chat-engine: the kit-specific transports/harness lib (not lib/utils).
const ENGINE_FILES = [
  'lib/transports/single-agent.ts',
  'lib/harness/events.ts',
  'lib/harness/use-harness-chat.ts',
];
{
  const c = classify(ENGINE_FILES);
  items.push({
    name: 'chat-engine',
    type: 'registry:lib',
    title: 'Chat Engine',
    description: 'Swappable transport + harness client for Agent mode and Harness mode.',
    dependencies: c.npm,
    registryDependencies: regDeps(c, 'chat-engine'),
    files: ENGINE_FILES.map((f) => ({ path: f, type: 'registry:lib', target: f })),
  });
}

// 3) chat-routes: the same-origin Next proxy routes the UI calls. Without these
// the installed chat block has nothing to fetch. They proxy 1:1 to a Mastra
// server at MASTRA_SERVER_URL (default http://localhost:4111). registry:file with
// explicit targets so they land at the exact app/ paths the components expect.
const ROUTE_FILES = [
  'lib/mastra-proxy.ts',
  'app/api/chat/[agentId]/route.ts',
  // Agent-mode threads (chat-sidebar + chat).
  'app/api/threads/route.ts',
  'app/api/threads/search/route.ts',
  'app/api/threads/[id]/route.ts',
  'app/api/threads/[id]/messages/route.ts',
  'app/api/threads/[id]/title/route.ts',
  // Harness mode. use-harness-chat.ts fetches ALL of these — shipping only
  // stream+approve left Harness mode dead on arrival for consumers (bd b5y).
  'app/api/harness/stream/route.ts',
  'app/api/harness/approve/route.ts',
  'app/api/harness/answer/route.ts',
  'app/api/harness/goal/route.ts',
  'app/api/harness/om/route.ts',
  'app/api/harness/schedules/route.ts',
  'app/api/harness/threads/route.ts',
  'app/api/harness/threads/search/route.ts',
  'app/api/harness/threads/[id]/route.ts',
  'app/api/harness/threads/[id]/messages/route.ts',
  // Workbench panels (files viewer + live browser screencast).
  'app/api/workspace/file/route.ts',
  'app/api/workspace/files/route.ts',
  'app/api/browser/screencast/route.ts',
  'app/api/images/[id]/route.ts',
];
{
  const c = classify(ROUTE_FILES);
  items.push({
    name: 'chat-routes',
    type: 'registry:block',
    title: 'Chat Routes (Mastra proxy)',
    description:
      'Same-origin Next route handlers + proxy that forward chat/threads/harness/images to a Mastra server (MASTRA_SERVER_URL). Required for the chat block to function.',
    dependencies: c.npm,
    registryDependencies: regDeps(c, 'chat-routes'),
    files: ROUTE_FILES.map((f) => ({ path: f, type: 'registry:file', target: f })),
  });
}

// 4) chat: the headline block — the canonical shell.
const CHAT_FILES = [
  'components/chat/chat.tsx',
  'components/chat/chat-sidebar.tsx',
  'components/chat/chat-switcher.tsx',
  'components/chat/composer.tsx',
  'components/chat/harness-chat.tsx',
  'components/chat/tool-views.tsx',
  // Harness mode's own shell. chat-switcher.tsx imports harness-sidebar and
  // workbench-panel directly, and workbench-panel pulls the four panels — so
  // omitting them shipped a chat-switcher that could not compile (bd b5y).
  'components/chat/harness-sidebar.tsx',
  'components/chat/workbench-panel.tsx',
  'components/chat/workbench-browser.tsx',
  'components/chat/workbench-files.tsx',
  'components/chat/workbench-memory.tsx',
  'components/chat/workbench-schedules.tsx',
];
{
  const c = classify(CHAT_FILES);
  items.push({
    name: 'chat',
    type: 'registry:block',
    title: 'Mastra Chat',
    description:
      'Canonical Mastra + AI Elements chat layer: conversation shell, composer, history sidebar, tool renderers, Agent/Harness modes.',
    dependencies: c.npm,
    // Appended explicitly (the import-trace can't discover these):
    // - chat-routes: the UI calls those endpoints via fetch, not import.
    // - sonner: the shell calls toast() but the styled <Toaster/> is ui/sonner.tsx,
    //   which the app mounts in its layout — ship it so consumers have it.
    registryDependencies: [...regDeps(c, 'chat'), 'sonner', NS('chat-routes')],
    files: CHAT_FILES.map((f) => ({ path: f, type: 'registry:component', target: f })),
  });
}

/**
 * Fail the build if the manifest is internally inconsistent — the two ways it
 * silently drifted before (bd mastra-chat-kit-b5y):
 *
 *   1. A shipped file imports a local module nobody ships → consumer gets
 *      module-not-found on first build.
 *   2. A shipped file fetches an `/api/*` path whose route handler isn't
 *      shipped → the UI renders but every call 404s.
 *
 * Files under `components/ui/` and `components/ai-elements/` are exempt from (1):
 * those arrive via registryDependencies, not our own `files`.
 */
function validate(allItems) {
  const shipped = new Set(allItems.flatMap((it) => it.files.map((f) => f.path)));
  const shippedKeys = new Set([...shipped].map((p) => p.replace(/\.tsx?$/, '')));
  const errors = [];

  // (1) every local import resolves to something we ship
  for (const rel of shipped) {
    for (const spec of parseImports(resolve(WEB, rel))) {
      let key = null;
      if (spec.startsWith('@/')) key = spec.slice(2);
      else if (spec.startsWith('.'))
        key = toPosix(relative(WEB, resolve(dirname(resolve(WEB, rel)), spec)));
      else continue; // bare npm specifier — covered by `dependencies`
      if (shippedKeys.has(key)) continue;
      if (key === 'lib/utils') continue; // shadcn init provides cn()
      if (key.startsWith('components/ui/')) continue; // registryDependency
      if (key.startsWith('components/ai-elements/')) continue; // registryDependency
      errors.push(`${rel} imports "${spec}" -> ${key}, which no registry item ships`);
    }
  }

  // (2) every /api/* the UI fetches has a shipped route handler
  const routeSegs = [...shipped]
    .filter((p) => p.startsWith('app/api/') && p.endsWith('/route.ts'))
    .map((p) => p.slice('app/'.length, -'/route.ts'.length).split('/'));
  const isDynamic = (s) => s.startsWith('[') || s.startsWith('${') || s.startsWith(':');
  const hasRoute = (segs) =>
    routeSegs.some(
      (r) =>
        r.length === segs.length &&
        r.every((rs, i) => rs === segs[i] || isDynamic(rs) || isDynamic(segs[i])),
    );

  // Strip comments first: JSDoc routinely names endpoints as backticked globs
  // (`/api/workspace/*`), which are prose, not calls.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const rel of shipped) {
    const src = stripComments(readFileSync(resolve(WEB, rel), 'utf8'));
    for (const m of src.matchAll(/["'`](\/api\/[^"'`\s]*)["'`]|["'`](\/api\/[^"'`\s]*)\?/g)) {
      const raw = (m[1] ?? m[2]).split('?')[0].replace(/\/$/, '');
      if (raw.includes('*')) continue; // glob in prose, not a real path
      const segs = raw.slice(1).split('/'); // drop leading "/" -> ['api', …]
      if (!hasRoute(segs))
        errors.push(`${rel} fetches "${raw}", but no registry item ships its route handler`);
    }
  }

  if (errors.length) {
    console.error(`\n❌ registry manifest is inconsistent (${errors.length}):\n`);
    for (const e of [...new Set(errors)].sort()) console.error(`  • ${e}`);
    console.error(
      '\nAdd the missing file to ROUTE_FILES / CHAT_FILES, or stop shipping the file that references it.\n',
    );
    process.exit(1);
  }
}

validate(items);

const registry = {
  $schema: 'https://ui.shadcn.com/schema/registry.json',
  name: REGISTRY_NAME,
  homepage: HOMEPAGE,
  items,
};

writeFileSync(resolve(WEB, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Wrote registry.json with ${items.length} items:`);
for (const it of items) {
  console.log(
    `  ${it.name} [${it.type}] deps=${it.dependencies.length} regDeps=${it.registryDependencies.length} files=${it.files.length}`,
  );
}
