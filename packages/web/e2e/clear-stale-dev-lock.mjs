// Removes packages/server/.mastra/dev.lock before the e2e Mastra server starts.
//
// On Windows, Playwright stops the webServer abruptly, so `mastra dev` never deletes
// its lock. The next `mastra dev` refuses to start while the lock's PID is alive,
// and Windows reuses PIDs, so an unrelated process can keep it "alive" indefinitely.
//
// Safe to delete unconditionally here: Playwright runs this command only when the
// server URL is NOT answering, so no healthy dev server owns the lock.
import { rmSync } from 'node:fs';
import path from 'node:path';

rmSync(path.resolve(import.meta.dirname, '../../server/.mastra/dev.lock'), { force: true });
