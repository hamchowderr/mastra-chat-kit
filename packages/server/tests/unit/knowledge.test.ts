import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibSQLStore } from '@mastra/libsql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packageRelative } from '../../src/lib/env';
import {
  createChatKnowledge,
  folderSource,
  type NoteSource,
  pagePath,
  type SourceDoc,
  splitFrontmatter,
  syncNotes,
  toPage,
} from '../../src/mastra/lib/knowledge';

/**
 * The env-free Knowledge pieces (lib/knowledge.ts): documents → pages, the folder
 * source, and the sync that mirrors a source into a scope. Each case gets its own
 * libSQL file, so no state leaks between them or into the shared test database.
 */

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../knowledge');
const SCOPE = 'org:test';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'chat-kit-knowledge-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function knowledgeIn(file: string) {
  return createChatKnowledge({
    storage: new LibSQLStore({ id: `k-${path.basename(file)}`, url: `file:${file}` }),
  });
}

async function pageNames(knowledge: ReturnType<typeof createChatKnowledge>): Promise<string[]> {
  const storage = await knowledge.getStorage();
  const [scope] = await storage.getScopesByAddress([SCOPE]);
  if (!scope) return [];
  const read = await knowledge.readScopeFor([SCOPE]);
  const { pages } = await storage.listPages({ read, scopeId: scope.id, limit: 200 });
  return pages.filter((p) => !p.deletedAt && !p.isScope).map((p) => p.name);
}

describe('documents → pages', () => {
  it('splits a leading frontmatter block and strips blank lines after it', () => {
    expect(splitFrontmatter('---\nname: X\n---\n\n# Body')).toEqual({
      frontmatter: ['name: X'],
      body: '# Body',
    });
    expect(splitFrontmatter('\n---\nname: X\n---\n').frontmatter).toBeNull();
  });

  it('names a page from frontmatter, then the first heading, then the file name', () => {
    expect(toPage({ path: 'a/b.md', body: '---\nname: "Named"\n---\n# Heading' }).name).toBe(
      'Named',
    );
    expect(toPage({ path: 'a/b.md', body: '# Heading' }).name).toBe('Heading');
    expect(toPage({ path: 'a/b.md', body: 'text' }).name).toBe('b');
  });

  it('keeps the description, drops frontmatter from the body, and strips .md from the path', () => {
    const page = toPage({ path: 'x.md', body: '---\ndescription: short\n---\nbody' });
    expect(page).toEqual({ name: 'x', description: 'short', body: 'body' });
    expect(pagePath('guides/tool-approvals.md')).toBe('guides/tool-approvals');
  });
});

describe('folderSource', () => {
  it('lists the sample folder as posix paths, skipping README.md', async () => {
    const docs = (await folderSource(SAMPLES).list()) ?? [];
    const paths = docs.map((d) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining(['agent-controller.md', 'memory.md', 'guides/tool-approvals.md']),
    );
    expect(paths.some((p) => p.endsWith('README.md'))).toBe(false);
  });

  it('lists null for a folder that does not exist, so a sync removes nothing', async () => {
    expect(await folderSource(path.join(dir, 'missing')).list()).toBeNull();
  });
});

describe('KNOWLEDGE_DIR resolution', () => {
  const pkg = path.resolve(SAMPLES, '..');

  // `mastra dev` runs the server with its cwd in src/mastra/public.
  it('resolves a relative path against the server package, from any cwd inside it', () => {
    expect(packageRelative('./knowledge', path.join(pkg, 'src/mastra/public'))).toBe(SAMPLES);
    expect(packageRelative('./knowledge', pkg)).toBe(SAMPLES);
  });

  it('keeps an absolute path, and falls back to the cwd with no package.json above it', () => {
    expect(packageRelative('/srv/notes', pkg)).toBe('/srv/notes');
    expect(packageRelative('./knowledge', dir)).toBe(path.join(dir, 'knowledge'));
  });
});

describe('syncNotes', () => {
  it('creates, leaves unchanged, updates and removes pages to mirror the source', async () => {
    const knowledge = knowledgeIn(path.join(dir, 'k.db'));
    let docs: SourceDoc[] | null = [
      { path: 'guides/a.md', body: '# A\nretainer' },
      { path: 'b.md', body: '# B' },
    ];
    const source: NoteSource = { id: 'fake', list: async () => docs };

    expect(await syncNotes(knowledge, SCOPE, source)).toMatchObject({ created: 2, removed: 0 });
    expect(await syncNotes(knowledge, SCOPE, source)).toEqual({
      created: 0,
      updated: 0,
      unchanged: 2,
      removed: 0,
    });

    docs = [{ path: 'guides/a.md', body: '# A\nretainer, now monthly' }];
    expect(await syncNotes(knowledge, SCOPE, source)).toMatchObject({ updated: 1, removed: 1 });
    expect(await pageNames(knowledge)).not.toContain('B');
    expect(await pageNames(knowledge)).toContain('A');

    docs = null;
    expect(await syncNotes(knowledge, SCOPE, source)).toBeNull();
    expect(await pageNames(knowledge)).toContain('A');
  });

  it('mirrors a folder: a deleted file loses its page', async () => {
    const root = path.join(dir, 'notes');
    await mkdir(root);
    await writeFile(path.join(root, 'keep.md'), '# Keep');
    await writeFile(path.join(root, 'drop.md'), '# Drop');
    const knowledge = knowledgeIn(path.join(dir, 'f.db'));

    expect(await syncNotes(knowledge, SCOPE, folderSource(root))).toMatchObject({ created: 2 });
    await rm(path.join(root, 'drop.md'));
    expect(await syncNotes(knowledge, SCOPE, folderSource(root))).toMatchObject({
      unchanged: 1,
      removed: 1,
    });
    expect(await pageNames(knowledge)).toEqual(['Keep']);
  });
});
