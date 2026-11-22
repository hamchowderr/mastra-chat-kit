/**
 * # Knowledge (Mastra Knowledge, experimental in @mastra/core 1.82+)
 *
 * The agent's knowledge base: markdown pages stored in libSQL next to memory, in the
 * org scope (`org:<id>`). The chat agent searches and reads them with
 * `knowledge_search` / `knowledge_read`, cites the page it used, and records new facts
 * with `knowledge_note` / `knowledge_page`. No RAG pipeline is involved: pages are found
 * by keyword search, blended with semantic search when a vector store and embedder are
 * passed.
 *
 * ## Where the pages come from
 *
 * A NoteSource lists markdown documents and `syncNotes` mirrors them into a scope: new
 * documents become pages, edited ones update their page, and one that disappears has
 * its page removed. Unchanged pages are not rewritten or re-embedded. index.ts runs the
 * sync at boot from `folderSource(KNOWLEDGE_DIR)`.
 *
 * A Notion, Drive or GitHub importer is another NoteSource, synced into the same scope
 * or a scope of its own. Another project reuses these pages by pointing its own
 * Knowledge at the same database and holding the same scope, or by copying this file
 * and syncing the same folder.
 *
 * Env-free: callers pass config, so tests build everything over fixtures without
 * booting the env schema. The env-bound instance is lib/chat-knowledge.ts.
 *
 * Knowledge APIs are experimental: @mastra/core is pinned exactly, re-test on every bump.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Knowledge, knowledgeMemoryScopes } from '@mastra/core/knowledge';
import type { MastraCompositeStore } from '@mastra/core/storage';
import type { MastraVector } from '@mastra/core/vector';

type KnowledgeEmbedder = ConstructorParameters<typeof Knowledge>[0]['embedder'];

/** One markdown document a source offers, at its source-relative posix path (`guides/memory.md`). */
export type SourceDoc = { path: string; body: string };

/**
 * A place notes come from. `list()` returns every document the source offers right now,
 * or `null` when it has nothing to say (a folder that isn't there), which syncs nothing
 * rather than reading as "every document was deleted".
 */
export interface NoteSource {
  /** Stable id: pages are attributed to `sync:<id>`, and only those are ever removed. */
  readonly id: string;
  list(): Promise<SourceDoc[] | null>;
}

// ── Knowledge instance ────────────────────────────────────────────────────────

export type ChatKnowledgeConfig = {
  /**
   * Its own store, so the agent works without being registered on a Mastra instance
   * (tests build agents on an in-memory Mastra).
   */
  storage: MastraCompositeStore;
  /** With an embedder, knowledge_search blends keyword and semantic results. */
  vector?: MastraVector;
  embedder?: KnowledgeEmbedder;
};

export function createChatKnowledge(config: ChatKnowledgeConfig): Knowledge {
  return new Knowledge({
    id: 'knowledge',
    name: 'Knowledge',
    description:
      'The knowledge base: docs synced from the knowledge folder (how this kit works), plus facts and decisions users asked the agent to remember.',
    scopes: { ...knowledgeMemoryScopes() },
    storage: config.storage,
    ...(config.vector && config.embedder
      ? { vector: config.vector, embedder: config.embedder }
      : {}),
    tools: true,
    pinnedContext: true,
  });
}

/** The read tools alone (search, read, list), for a run that must not write: the research specialist. */
export const READ_ONLY_TOOLS = { write: false, pinnedContext: false } as const;

// ── Documents → pages ─────────────────────────────────────────────────────────

/** The frontmatter block and the body after it. Only a block that starts on the first line counts. */
export function splitFrontmatter(text: string): { frontmatter: string[] | null; body: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { frontmatter: null, body: text };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { frontmatter: null, body: text };
  return {
    frontmatter: lines.slice(1, end),
    body: lines
      .slice(end + 1)
      .join('\n')
      .replace(/^\n+/, ''),
  };
}

function frontmatterValue(frontmatter: string[] | null, key: string): string | undefined {
  const line = frontmatter?.find((l) => l.startsWith(`${key}:`));
  const value = line
    ?.slice(key.length + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
  return value || undefined;
}

/** A document's page path: its source path without `.md` (`guides/memory.md` → `guides/memory`). */
export function pagePath(docPath: string): string {
  return docPath.replace(/\.md$/, '');
}

/** Page name, description and body for a document. */
export function toPage(doc: SourceDoc): { name: string; description?: string; body: string } {
  const { frontmatter, body } = splitFrontmatter(doc.body);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fileName = path.posix.basename(pagePath(doc.path));
  const description = frontmatterValue(frontmatter, 'description');
  return {
    name: frontmatterValue(frontmatter, 'name') ?? heading ?? fileName,
    // Knowledge caps descriptions at 100 tokens; a long one is cut, not refused.
    ...(description ? { description: description.slice(0, 300) } : {}),
    body,
  };
}

// ── Sources ───────────────────────────────────────────────────────────────────

/**
 * Every markdown file under `root`, as source-relative posix paths. Dotfiles and
 * `README.md` files are skipped, so a folder can explain itself without becoming a
 * page. A `root` that does not exist lists `null` (a deployed image may ship none).
 */
export function folderSource(root: string, id = 'folder'): NoteSource {
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((e) => {
        if (e.name.startsWith('.') || e.name === 'README.md') return Promise.resolve([]);
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        return Promise.resolve(e.name.endsWith('.md') ? [full] : []);
      }),
    );
    return nested.flat();
  }
  return {
    id,
    async list() {
      const files = await walk(root).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!files) return null;
      return Promise.all(
        files.sort().map(async (file) => ({
          path: path.relative(root, file).split(path.sep).join('/'),
          body: await readFile(file, 'utf-8'),
        })),
      );
    },
  };
}

// ── Sync ──────────────────────────────────────────────────────────────────────

export type SyncCounts = { created: number; updated: number; unchanged: number; removed: number };

/** Paths (`a/b`) of the pages in `scope` that `author` created. */
async function pagesCreatedBy(
  knowledge: Knowledge,
  scope: string,
  author: string,
): Promise<string[]> {
  const storage = await knowledge.getStorage();
  const [scopePage] = await storage.getScopesByAddress([scope]);
  if (!scopePage) return [];
  const read = await knowledge.readScopeFor([scope]);
  const byId = new Map<string, { parentId: string | null; key?: string; author?: string }>();
  let cursor: string | undefined;
  do {
    const out = await storage.listPages({ read, scopeId: scopePage.id, cursor, limit: 200 });
    for (const p of out.pages) {
      const page = p as typeof p & { key?: string; createdBy?: { author?: string } };
      byId.set(page.id, {
        parentId: page.parentId ?? null,
        key: page.key,
        author: page.createdBy?.author,
      });
    }
    cursor = out.nextCursor;
  } while (cursor);

  const pathOf = (id: string): string | undefined => {
    const parts: string[] = [];
    let current = byId.get(id);
    let currentId: string | null = id;
    while (current && currentId !== scopePage.id) {
      if (!current.key) return undefined;
      parts.unshift(current.key);
      currentId = current.parentId;
      current = currentId ? byId.get(currentId) : undefined;
    }
    return parts.join('/');
  };
  return [...byId]
    .filter(([, p]) => p.author === author)
    .map(([id]) => pathOf(id))
    .filter((p): p is string => Boolean(p));
}

/**
 * Mirror `source` into `scope`. Returns null when the source listed nothing. Pages the
 * source created but no longer lists are removed, deepest first; a page that has since
 * gained child pages (written by the agent) is kept.
 */
export async function syncNotes(
  knowledge: Knowledge,
  scope: string,
  source: NoteSource,
): Promise<SyncCounts | null> {
  const docs = await source.list();
  if (!docs) return null;
  const author = `sync:${source.id}`;
  const counts: SyncCounts = { created: 0, updated: 0, unchanged: 0, removed: 0 };
  const listed = new Set<string>();
  for (const doc of docs) {
    const p = pagePath(doc.path);
    const { status } = await knowledge.upsertPage({ scope, path: p, author, ...toPage(doc) });
    counts[status]++;
    listed.add(p);
  }
  // A listed page's parents stay too, whoever made them.
  for (const p of [...listed]) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) listed.add(parts.slice(0, i).join('/'));
  }
  const gone = (await pagesCreatedBy(knowledge, scope, author))
    .filter((p) => !listed.has(p))
    .sort((a, b) => b.split('/').length - a.split('/').length);
  for (const p of gone) {
    try {
      if (await knowledge.removePage({ scope, path: p, author })) counts.removed++;
    } catch {
      // Has child pages now; keep it rather than take the agent's pages with it.
    }
  }
  return counts;
}
