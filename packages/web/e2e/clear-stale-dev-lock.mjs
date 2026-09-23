// Removes a stale packages/server/.mastra/dev.lock before the e2e Mastra server starts.
//
// On Windows, Playwright stops the webServer abruptly, so `mastra dev` never deletes
// its lock. The next `mastra dev` refuses to start while the lock's PID is alive,
// and Windows reuses PIDs, so an unrelated process can keep it "alive" indefinitely.
//
// `mastra dev` writes `{ pid }` at startup and `{ pid, host, port }` once it listens.
// The lock is deleted only when it cannot belong to a healthy server:
// - its PID is dead, or
// - its port is the e2e server port (PORT, set by playwright.config.ts). Playwright
//   runs this command only when that port is not answering, so a server that
//   listened there is gone, whatever process now holds the PID.
// Anything else (a live PID with no port yet, or another port) may be a developer's
// own `pnpm dev` still bundling, so the lock is left alone and `mastra dev` reports it.
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const lockPath = path.resolve(import.meta.dirname, '../../server/.mastra/dev.lock');
const e2ePort = Number(process.env.PORT);

let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
} catch (err) {
  if (err.code === 'ENOENT') process.exit(0);
  // Unreadable or half-written: no server can be identified as its owner.
  rmSync(lockPath, { force: true });
  console.log('[e2e] removed an unreadable mastra dev lock');
  process.exit(0);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to another user.
    return err.code === 'EPERM';
  }
}

if (!pidAlive(lock.pid)) {
  rmSync(lockPath, { force: true });
  console.log(`[e2e] removed a stale mastra dev lock (pid ${lock.pid} is not running)`);
} else if (Number.isInteger(e2ePort) && lock.port === e2ePort) {
  rmSync(lockPath, { force: true });
  console.log(`[e2e] removed a stale mastra dev lock (port ${e2ePort} is not answering)`);
} else {
  console.log(
    `[e2e] kept the mastra dev lock: pid ${lock.pid} is running` +
      (lock.port
        ? ` on port ${lock.port}, not the e2e port ${e2ePort}`
        : ' and has not bound a port yet'),
  );
}
