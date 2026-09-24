#!/usr/bin/env node
/**
 * Reset the local server to a clean slate before the live demo (docs/demo.md).
 *
 *   pnpm demo:reset
 *
 * Deletes what a demo run leaves behind, so the next run starts from nothing:
 *  - the libSQL database: threads, messages, the semantic-recall index and persisted
 *    schedules. Under `mastra dev` the server runs from packages/server/src/mastra/public,
 *    so its database lives THERE, not in packages/server; both are cleared.
 *  - the DuckDB observability store beside it.
 *  - the agent's workspace (fizzbuzz.js, plans/…): a second run's write would hit the
 *    existing file and fail on stage.
 *
 * "Always allow" grants live in the server's memory, so they clear when the server
 * restarts, which it has to anyway: this refuses to run while :4111 is serving, because
 * the server holds the database open (and on Windows the delete would fail).
 * Deletes only these known paths.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/server');
const devCwd = path.join(server, 'src/mastra/public');
const port = Number(process.env.PORT ?? 4111);

const listening = await new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port }, () => {
    socket.end();
    resolve(true);
  });
  socket.on('error', () => resolve(false));
});
if (listening) {
  console.error(`The server is still running on :${port}. Stop it (Ctrl+C), then run this again.`);
  process.exit(1);
}

const dbFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^mastra\.(db|duckdb)(-shm|-wal|\.wal)?$/.test(f))
        .map((f) => path.join(dir, f))
    : [];

const targets = [
  ...dbFiles(server),
  ...dbFiles(devCwd),
  path.join(devCwd, 'agent-workspace'),
  path.join(server, 'agent-workspace'),
].filter((p) => existsSync(p));

for (const p of targets) {
  rmSync(p, { recursive: true, force: true });
  console.log(`removed ${path.relative(process.cwd(), p)}`);
}
console.log(targets.length ? 'Demo state reset.' : 'Nothing to reset — already clean.');
