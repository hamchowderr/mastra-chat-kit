import { execSync } from 'node:child_process';

/**
 * Clear persisted chat state before the run so each e2e starts from an empty
 * history. Threads + messages + working-memory + the fastembed vector index all
 * live in the pgvector Postgres; left to accumulate across runs they pollute
 * Memory recall and make the turn-indexed fixtures non-deterministic, and they
 * fill the history sidebar with stale titles.
 *
 * Best-effort: truncates via `docker exec` against the pgvector container
 * (override the name with E2E_PG_CONTAINER). If Postgres lives elsewhere, skip
 * this and point E2E_DB_URL at a throwaway database instead.
 */
const TABLES = ['mastra_messages', 'mastra_threads', 'mastra_resources', 'memory_messages_384'];

export default function globalSetup() {
  const container = process.env.E2E_PG_CONTAINER ?? 'chatkit-pg';
  try {
    execSync(
      `docker exec ${container} psql -U postgres -d postgres -c "TRUNCATE ${TABLES.join(', ')} CASCADE;"`,
      { stdio: 'ignore' },
    );
  } catch {
    // Tables may not exist yet on first boot, or Postgres isn't the docker
    // container — non-fatal. Tests tolerate a non-empty start via scoped
    // assertions, but a clean DB keeps them deterministic.
    console.warn('[e2e global-setup] could not truncate chat tables; continuing');
  }
}
