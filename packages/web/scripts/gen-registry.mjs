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
// Where the built registry is served from. `pnpm build:registry` writes the item
// JSON to packages/web/public/r/, which is deployed as a plain static site — the
// registry needs no framework, so this host is independent of wherever the demo
// app runs. Consumers map "@mastra-chat-kit" -> "<HOMEPAGE>/r/{name}.json".
const HOMEPAGE = 'https://mastra-chat-kit-registry.vercel.app';
const UPSTREAM = (name) => `https://ai-sdk.dev/elements/api/registry/${name}.json`;

// AI Elements we ship ourselves (everything else comes from Vercel upstream).
const LOCAL_ELEMENTS = new Set(['code-block', 'image', 'context', 'tool', 'agent']);

// Host-provided packages — never list as registry npm dependencies.
const HOST_PKGS = new Set(['react', 'react-dom', 'next']);

/**
 * Packages whose MAJOR must match what we tested against, emitted to consumers
 * as `name@range` instead of a bare name.
 *
 * A bare name means the consumer installs whatever is latest, which is not
 * necessarily what CI verified. That is not hypothetical: `@streamdown/code`
 * declares its `CodeHighlighterPlugin` against shiki's types and depends on
 * shiki ^3, while this workspace shipped a bare `shiki` and had pinned ^4.
 * A consumer therefore resolved shiki 4 next to the plugin's shiki 3, giving
 * two distinct declarations of the same type — and upstream's message.tsx and
 * reasoning.tsx failed to typecheck with "{ cjk, code, math, mermaid } is not
 * assignable to PluginConfig", despite the shapes being identical.
 *
 * Deliberately an allowlist, not blanket pinning of every dependency: pinning
 * something a consumer already has (say `ai`) would fight their own resolution
 * for no benefit. Add an entry only when a version SKEW breaks the install.
 */
const PINNED_DEPS = new Map([['shiki', '^3.23.0']]);
const withVersion = (pkg) => (PINNED_DEPS.has(pkg) ? `${pkg}@${PINNED_DEPS.get(pkg)}` : pkg);

const toPosix = (p) => p.split('\\').join('/');
const elPath = (n) => `components/ai-elements/${n}.tsx`;

// Files that live in components/chat/ but are shipped as their OWN registry item
// because more than one skin needs them. Importing one of these from a different
// item must produce a registryDependency, not a silent assumption that it's a
// sibling in the same block — see validate() check (4) and bd 23d.
const SHARED_ITEM_OF = {
  'components/chat/tool-views': 'chat-tool-views',
};

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
        if (!HOST_PKGS.has(pkg)) npm.add(withVersion(pkg));
        continue;
      }
      if (ownKeys.has(key)) continue; // import within this same item
      if (key.startsWith('components/ai-elements/')) noteElement(posix.basename(key));
      else if (key.startsWith('components/ui/')) ui.add(posix.basename(key));
      else if (key === 'lib/utils') {
        /* cn() — shadcn init provides this; not a registry dep */
      } else if (key.startsWith('lib/')) lib.add('chat-engine');
      else if (SHARED_ITEM_OF[key] && !ownKeys.has(key)) {
        // A file shipped by a DIFFERENT item (e.g. tool-views, shared by every
        // skin) — it must become a registryDependency or the install is missing it.
        lib.add(SHARED_ITEM_OF[key]);
      } else if (key.startsWith('components/chat/')) {
        /* Sibling within this same block. NOT assumed present — validate() below
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

// Printed by the shadcn CLI after install (registry-item `docs` field). The base
// mismatch is invisible until it surfaces as a type error deep in a trigger, so
// say it where a consumer who never opened our docs will still see it (bd og7).
const RADIX_NOTICE = `This kit needs TWO things in your project. Check both:

  1. The RADIX base       ->  npx shadcn@latest init --base radix
  2. The LUCIDE icon set  ->  "iconLibrary": "lucide" in components.json

With both, a fresh install typechecks with 0 errors and \`next build\` exits 0
(verified on shadcn CLI 4.16.0 / Next 16.2.6).

If either is wrong:
  • Base UI instead of Radix (a bare \`init\` gives you this — --defaults resolves
    to --preset=base-nova) -> 14 type errors. This kit's own components port fine
    either way (the CLI rewrites \`asChild\` to Base UI's \`render\`), but the upstream
    Vercel AI Elements it depends on are Radix-authored and don't survive that.
  • hugeicons instead of lucide -> 1 type error and a failed build, in shadcn's own
    ui/spinner.tsx. Fix: set iconLibrary to lucide, then
    \`shadcn add spinner --overwrite\`.

Then set MASTRA_SERVER_URL to point at your Mastra server (default
http://localhost:4111). See ${HOMEPAGE} for the full endpoint contract.`;

const items = [];

// 1) The 4 vendored AI Elements (3 patched + tool rewired to our code-block).
const ELEMENT_TITLES = {
  'code-block': 'Code Block (SSR-safe)',
  image: 'Image',
  context: 'Context',
  tool: 'Tool',
  agent: 'Agent',
};
const ELEMENT_DESCS = {
  'code-block':
    'AI Elements code block with an SSR hydration fix (mount-gated Shiki highlighting).',
  image: 'AI Elements image; renders from base64 (uint8Array optional).',
  context: 'AI Elements context/usage display (Partial usage type).',
  tool: 'AI Elements tool call display, wired to the local SSR-safe code block.',
  agent:
    'AI Elements agent/tool roster with a strict-TS fit: a Tool `description` can be a function, which is not a ReactNode, so it is narrowed before render.',
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

// 2) chat-engine: the kit-specific transports/controller lib (not lib/utils).
// The engine is everything a chat UI needs that ISN'T a look: the SSE transport,
// the transcript reducer, and the data hooks that own every /api/* call. A skin
// built on these is pure rendering — see bd h27 / 23d.
const ENGINE_FILES = [
  'lib/agent-controller/events.ts',
  'lib/agent-controller/reduce.ts',
  'lib/agent-controller/reduce-helpers.ts',
  'lib/agent-controller/use-agent-controller-chat.ts',
  'lib/agent-controller/use-threads.ts',
  'lib/agent-controller/use-workspace.ts',
];
{
  const c = classify(ENGINE_FILES);
  items.push({
    name: 'chat-engine',
    type: 'registry:lib',
    title: 'Chat Engine',
    description: 'Agent Controller SSE client + transcript reducer.',
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
  // use-agent-controller-chat.ts + the workbench panels fetch ALL of these — shipping
  // only stream+approve left the controller dead on arrival for consumers (bd b5y).
  'app/api/agent-controller/stream/route.ts',
  'app/api/agent-controller/approve/route.ts',
  'app/api/agent-controller/answer/route.ts',
  'app/api/agent-controller/goal/route.ts',
  'app/api/agent-controller/om/route.ts',
  'app/api/agent-controller/schedules/route.ts',
  'app/api/agent-controller/threads/route.ts',
  'app/api/agent-controller/threads/search/route.ts',
  'app/api/agent-controller/threads/[id]/route.ts',
  'app/api/agent-controller/threads/[id]/messages/route.ts',
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
      'Same-origin Next route handlers + proxy that forward chat/threads/agent-controller/images to a Mastra server (MASTRA_SERVER_URL). Required for the chat block to function.',
    dependencies: c.npm,
    registryDependencies: regDeps(c, 'chat-routes'),
    files: ROUTE_FILES.map((f) => ({ path: f, type: 'registry:file', target: f })),
  });
}

// 3b) chat-server: the OTHER half. chat-routes above are Next proxies — they
// forward to a Mastra server but do not implement it, so a consumer who installs
// only the web side gets a UI that renders and then 404s on every request. This
// item ships the endpoints those proxies call, to drop into a consumer's own
// Mastra project.
//
// It is deliberately SMALL. The route modules take their dependencies through
// ChatServerDeps (see the server package's routes/types.ts) rather than importing
// this repo's wiring, so shipping them does NOT drag along our six agents, our
// storage, our Dolt setup or our env schema — measured at 2283 lines across 20
// files before that seam existed (bd mastra-chat-kit-6vl). What ships is the
// route contract and one pure helper module.
//
// Paths are relative to packages/web because that is where registry.json lives;
// targets are where they land in the consumer's Mastra project. The relative
// import `../lib/thread-utils` inside the routes resolves correctly because the
// targets preserve the routes/ ↔ lib/ layout.
const SERVER_FILES = [
  ['../server/src/mastra/routes/types.ts', 'src/mastra/routes/types.ts'],
  ['../server/src/mastra/routes/threads.ts', 'src/mastra/routes/threads.ts'],
  ['../server/src/mastra/routes/controller.ts', 'src/mastra/routes/controller.ts'],
  ['../server/src/mastra/routes/workspace.ts', 'src/mastra/routes/workspace.ts'],
  // Pure formatting helpers the thread routes need. No imports of its own.
  ['../server/src/mastra/lib/thread-utils.ts', 'src/mastra/lib/thread-utils.ts'],
];
items.push({
  name: 'chat-server',
  type: 'registry:file',
  title: 'Chat Server (AgentController route contract)',
  description:
    "The 16 Mastra endpoints the chat layer calls — threads, the AgentController stream and its approval/answer gates, goals, observational memory, schedules, workspace and browser screencast. Register them on your own Mastra instance and supply a ChatServerDeps; nothing about this repo's agents or storage comes with it.",
  // Every import in these files is @mastra/core/* or a sibling that ships here.
  dependencies: ['@mastra/core'],
  registryDependencies: [],
  files: SERVER_FILES.map(([path, target]) => ({ path, type: 'registry:file', target })),
});

// 4) chat-tool-views: the SHARED renderers that turn real tool output into elements
// (sources, generated images, plan, goal card, ask_user prompt, workspace views).
// Promoted out of the `chat` block so a second skin depends on THIS rather than on
// the other skin — skins must never import each other (bd 23d).
const TOOL_VIEW_FILES = ['components/chat/tool-views.tsx'];
{
  const c = classify(TOOL_VIEW_FILES);
  items.push({
    name: 'chat-tool-views',
    type: 'registry:component',
    title: 'Chat Tool Views',
    description:
      'Shared renderers mapping real agent tool output onto AI Elements — used by every chat skin.',
    dependencies: c.npm,
    registryDependencies: regDeps(c, 'chat-tool-views'),
    files: TOOL_VIEW_FILES.map((f) => ({ path: f, type: 'registry:component', target: f })),
  });
}

// 5) chat: the headline block — the canonical full shell (sidebar │ chat │ workbench).
const CHAT_FILES = [
  'components/chat/chat-switcher.tsx',
  'components/chat/composer.tsx',
  'components/chat/agent-controller-chat.tsx',
  // AgentController mode's own shell. chat-switcher.tsx imports agent-controller-sidebar and
  // workbench-panel directly, and workbench-panel pulls the four panels — so
  // omitting them shipped a chat-switcher that could not compile (bd b5y).
  'components/chat/agent-controller-sidebar.tsx',
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
      'The full Agent Controller shell: conversation history sidebar, chat, and the agent workbench (browser, files, memory, schedules).',
    dependencies: c.npm,
    // Appended explicitly (the import-trace can't discover these):
    // - chat-routes: the UI calls those endpoints via fetch, not import.
    // - sonner: the shell calls toast() but the styled <Toaster/> is ui/sonner.tsx,
    //   which the app mounts in its layout — ship it so consumers have it.
    registryDependencies: [...regDeps(c, 'chat'), 'sonner', NS('chat-routes')],
    files: CHAT_FILES.map((f) => ({ path: f, type: 'registry:component', target: f })),
    docs: RADIX_NOTICE,
  });
}

// 6) chat-minimal: a SECOND skin over the same engine — conversation + composer only.
// Proves the split is real: same AgentController session (threads, approvals,
// subagents, workspace), a completely different shell, and no dependency on `chat`.
const MINIMAL_FILES = ['components/chat-minimal/minimal-chat.tsx'];
{
  const c = classify(MINIMAL_FILES);
  items.push({
    name: 'chat-minimal',
    type: 'registry:block',
    title: 'Mastra Chat (minimal)',
    description:
      'Embeddable Agent Controller chat — conversation, composer, tool approvals and ask_user, with no sidebar or workbench.',
    dependencies: c.npm,
    registryDependencies: [...regDeps(c, 'chat-minimal'), NS('chat-routes')],
    files: MINIMAL_FILES.map((f) => ({ path: f, type: 'registry:component', target: f })),
    docs: RADIX_NOTICE,
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

  // (3) the reverse of (2): every shipped route handler has a caller.
  //
  // (2) alone is one-directional, which is how five dead /api/threads* proxies
  // stayed in a PUBLISHED registry after the sidebar that called them was deleted
  // (bd e70) — consumers installed routes nothing fetched, against a resource id
  // the shipped UI never reads. A route with no caller is either dead or a missing
  // caller; both are bugs worth failing the build over.
  const fetched = new Set();
  for (const rel of shipped) {
    const src = stripComments(readFileSync(resolve(WEB, rel), 'utf8'));
    for (const m of src.matchAll(/["'`](\/api\/[^"'`\s]*)/g)) {
      const raw = m[1].split('?')[0].replace(/\/$/, '');
      if (raw.includes('*')) continue;
      fetched.add(raw.slice(1).split('/').join('/'));
    }
  }
  const isCalled = (segs) =>
    [...fetched].some((f) => {
      const fs = f.split('/');
      return (
        fs.length === segs.length &&
        fs.every((s, i) => s === segs[i] || isDynamic(s) || isDynamic(segs[i]))
      );
    });
  for (const segs of routeSegs) {
    // A route file is only reachable from the browser via a fetch in shipped
    // source; the proxy lib itself is called with a SERVER path, not /api/*.
    if (!isCalled(segs)) {
      errors.push(
        `app/${segs.join('/')}/route.ts is shipped, but no shipped file fetches "/${segs.join('/')}"`,
      );
    }
  }

  // (4) cross-item imports must be declared as registryDependencies.
  //
  // (1) only asserts a local import is shipped by SOME item. That was sufficient
  // while every chat file lived in one block, but the moment a file is promoted to
  // its own item (tool-views → chat-tool-views, bd 23d) an importing item can pass
  // (1) while never pulling the item that ships it — shadcn then installs an
  // incomplete tree that fails to compile in the consumer's project.
  const itemOf = new Map();
  for (const it of allItems)
    for (const f of it.files) itemOf.set(f.path.replace(/\.tsx?$/, ''), it.name);
  for (const it of allItems) {
    const own = new Set(it.files.map((f) => f.path.replace(/\.tsx?$/, '')));
    const declared = new Set(
      (it.registryDependencies ?? []).map((d) => d.replace(`@${REGISTRY_NAME}/`, '')),
    );
    for (const f of it.files) {
      for (const spec of parseImports(resolve(WEB, f.path))) {
        const key = spec.startsWith('@/')
          ? spec.slice(2)
          : spec.startsWith('.')
            ? toPosix(relative(WEB, resolve(dirname(resolve(WEB, f.path)), spec)))
            : null;
        if (!key || own.has(key)) continue;
        const owner = itemOf.get(key);
        if (owner && owner !== it.name && !declared.has(owner)) {
          errors.push(
            `item "${it.name}" imports ${key} (shipped by "${owner}") but does not list @${REGISTRY_NAME}/${owner} in registryDependencies`,
          );
        }
      }
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
