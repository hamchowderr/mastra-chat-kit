import { rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Reset persisted chat state before the run so each e2e starts from an empty
 * history. Threads, messages, working memory, and the fastembed vector index all
 * live in the server's libSQL file DB; left to accumulate across runs they pollute
 * Memory recall (making the turn-indexed AIMock fixtures non-deterministic) and
 * fill the history sidebar with stale titles.
 *
 * Best-effort: deletes the libSQL e2e DB file (+ WAL/SHM sidecars). Playwright runs
 * this from `packages/web`, and the server (started by the webServer config) writes
 * `file:./mastra-e2e.db` relative to `packages/server`. Override with E2E_DB_FILE.
 */
const DB_FILE = process.env.E2E_DB_FILE ?? path.resolve(process.cwd(), '../server/mastra-e2e.db');

export default function globalSetup() {
  for (const f of [DB_FILE, `${DB_FILE}-shm`, `${DB_FILE}-wal`]) {
    try {
      rmSync(f, { force: true });
    } catch {
      // Locked (server already holds it) or absent — non-fatal. Tests tolerate a
      // non-empty start via scoped assertions; a clean DB just keeps them tidy.
    }
  }
}
