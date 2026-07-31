/**
 * Read-only view of the controller agent's workspace directory (`WORKSPACE_ROOT`)
 * for the web Files panel. We walk the real folder on disk directly rather than
 * reconstruct it from tool calls, so the panel reflects ground truth regardless
 * of how files got there (agent tools, seeds, or the user).
 *
 * Everything is confined to `WORKSPACE_ROOT`: `readWorkspaceFile` rejects any path
 * that resolves outside it (path-traversal guard).
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_ROOT } from './agent-controller';

export type FileNode = {
  name: string;
  /** Path relative to WORKSPACE_ROOT, forward-slashed. */
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
};

const IGNORE = new Set(['.git', 'node_modules', '.DS_Store']);
const MAX_NODES = 2000;
const MAX_FILE_BYTES = 200_000;

/** Walk WORKSPACE_ROOT into a nested tree (dirs first, then alphabetical). */
export async function readWorkspaceTree(): Promise<FileNode[]> {
  let count = 0;

  async function walk(absDir: string, relDir: string): Promise<FileNode[]> {
    // Infer the Dirent[] (string-named) overload from the `{ withFileTypes: true }`
    // call; a missing/unreadable dir → empty (the workspace may not exist yet).
    const entries = await readdir(absDir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const nodes: FileNode[] = [];
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      if (count++ > MAX_NODES) break;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        nodes.push({
          name: e.name,
          path: rel,
          type: 'dir',
          children: await walk(path.join(absDir, e.name), rel),
        });
      } else if (e.isFile()) {
        nodes.push({ name: e.name, path: rel, type: 'file' });
      }
    }
    return nodes;
  }

  return walk(WORKSPACE_ROOT, '');
}

/**
 * Read one file's text content, confined to WORKSPACE_ROOT. Returns null if the
 * path escapes the root or the file can't be read. Large files are truncated.
 */
export async function readWorkspaceFile(
  relPath: string,
): Promise<{ path: string; content: string; truncated: boolean } | null> {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(WORKSPACE_ROOT, normalized);
  // Path-traversal guard: the resolved path must stay within WORKSPACE_ROOT.
  const rel = path.relative(WORKSPACE_ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try {
    // `utf8` yields a string at runtime; this @types/node overload widens it to
    // `string | Buffer`, so narrow it back.
    const raw = (await readFile(abs, 'utf8')) as string;
    const truncated = raw.length > MAX_FILE_BYTES;
    return {
      path: normalized,
      content: truncated ? `${raw.slice(0, MAX_FILE_BYTES)}\n\n… (truncated)` : raw,
      truncated,
    };
  } catch {
    return null;
  }
}
