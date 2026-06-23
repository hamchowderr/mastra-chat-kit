import mysql from 'mysql2/promise';

/**
 * Dolt connection — Dolt speaks the MySQL wire protocol, so this is a normal
 * mysql2 pool. The only Dolt-specific part is `commit()` (CALL DOLT_COMMIT),
 * which turns every write into a versioned, auditable commit (diff/history/
 * time-travel/rollback). Pattern lifted from dolt-mastra-lab.
 *
 * Connection comes from env (set by the compose stack / Coolify):
 *   DOLT_HOST (service name `dolt` in the stack) · DOLT_PORT · DOLT_USER
 *   DOLT_PASSWORD · DOLT_DATABASE
 */
const config = {
  host: process.env.DOLT_HOST || '127.0.0.1',
  port: Number(process.env.DOLT_PORT || 3306),
  user: process.env.DOLT_USER || 'root',
  password: process.env.DOLT_PASSWORD || '',
  database: process.env.DOLT_DATABASE || 'appdb',
  dateStrings: true as const,
};

export const doltConfigured = Boolean(process.env.DOLT_HOST || process.env.DOLT_PORT);

let _pool: mysql.Pool | null = null;
export function pool(): mysql.Pool {
  if (!_pool) _pool = mysql.createPool({ ...config, connectionLimit: 4 });
  return _pool;
}

/** Run any SQL. Returns rows for SELECT, the result header for writes. */
export async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const [result] = await pool().query(sql, params);
  return result as T;
}

export async function select<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return query<T[]>(sql, params);
}

export interface CommitMeta {
  /** "Agent Name <agent@you>" — drives dolt_log.committer + dolt_blame. */
  author?: string;
  directedBy?: string;
  autonomy?: 'directed' | 'autonomous';
}

/**
 * Stage all changes and commit — `git commit` for your data. Dolt exposes one
 * identity per commit via --author; the director + autonomy ride along as
 * message trailers (queryable in dolt_log.message). Returns the commit hash.
 */
export async function commit(summary: string, meta: CommitMeta = {}): Promise<string> {
  const author = meta.author ?? 'Mastra Agent <agent@otaku.local>';
  const message =
    meta.author || meta.directedBy || meta.autonomy
      ? `${summary}\n\nActed-by: ${(meta.author ?? '').replace(/\s*<[^>]*>\s*$/, '')} (agent)\n` +
        `Directed-by: ${meta.directedBy ?? 'unknown'}\nAutonomy: ${meta.autonomy ?? 'directed'}`
      : summary;
  const r = (await query("CALL DOLT_COMMIT('-A', '-m', ?, '--author', ?)", [
    message,
    author,
  ])) as unknown;
  const row = (Array.isArray(r) ? (Array.isArray(r[0]) ? r[0][0] : r[0]) : r) as { hash?: string };
  return row?.hash ?? '(committed)';
}

/**
 * First-boot bootstrap: ensure the database exists (Dolt CREATE DATABASE makes a
 * new versioned db). Safe to call repeatedly. Call before first use against a
 * fresh `dolt sql-server` volume.
 */
export async function ensureDatabase(): Promise<void> {
  const admin = await mysql.createConnection({ ...config, database: undefined });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
  } finally {
    await admin.end();
  }
}
