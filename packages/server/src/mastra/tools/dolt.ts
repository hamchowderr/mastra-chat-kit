import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { commit, query, select } from '../lib/dolt';

/**
 * Generic Dolt tools — the bridge between a Mastra agent and the
 * version-controlled business database. The agent never knows it's talking to
 * a versioned DB; it just calls these. Every write ends in a Dolt commit, so
 * the agent's actions are automatically auditable and reversible.
 *
 * Adapt these for your domain (e.g. typed `addCustomer` instead of raw SQL).
 * See dolt-mastra-lab for the branch-per-agent "propose → human merges" pattern.
 */

const PERSONA = process.env.AGENT_PERSONA || 'Mastra Agent <agent@otaku.local>';
const DIRECTOR = process.env.DIRECTOR || 'operator';
const ATTRIBUTION = { author: PERSONA, directedBy: DIRECTOR, autonomy: 'directed' as const };

export const doltQuery = createTool({
  id: 'doltQuery',
  description: 'Run a read-only SQL SELECT against the versioned Dolt database. Returns rows.',
  inputSchema: z.object({
    sql: z.string().describe('A single SELECT statement'),
    params: z.array(z.any()).optional().describe('Positional ? parameters'),
  }),
  outputSchema: z.object({ rows: z.array(z.any()) }),
  execute: async ({ sql, params }) => {
    if (!/^\s*select/i.test(sql))
      throw new Error('doltQuery is read-only; use doltWrite for changes.');
    return { rows: await select(sql, params ?? []) };
  },
});

export const doltWrite = createTool({
  id: 'doltWrite',
  description:
    'Run a write SQL statement (INSERT/UPDATE/DELETE/DDL) against the Dolt database and record it as one attributed Dolt commit (versioned, auditable, reversible). Provide a short human summary for the commit message.',
  inputSchema: z.object({
    sql: z.string().describe('A single write statement'),
    params: z.array(z.any()).optional(),
    summary: z
      .string()
      .describe('Short description of the change (becomes the Dolt commit message)'),
  }),
  outputSchema: z.object({ affectedRows: z.number(), commit: z.string() }),
  execute: async ({ sql, params, summary }) => {
    if (/^\s*select/i.test(sql)) throw new Error('Use doltQuery for reads.');
    const res = (await query(sql, params ?? [])) as { affectedRows?: number };
    const hash = await commit(summary, ATTRIBUTION);
    return { affectedRows: res.affectedRows ?? 0, commit: hash.slice(0, 8) };
  },
});

export const doltHistory = createTool({
  id: 'doltHistory',
  description: 'Show recent commit history of the database (who changed what, when, why).',
  inputSchema: z.object({ limit: z.number().min(1).max(50).default(10) }),
  outputSchema: z.object({ commits: z.array(z.any()) }),
  execute: async ({ limit }) => {
    const commits = await select(
      'SELECT commit_hash, committer, date, message FROM dolt_log ORDER BY date DESC LIMIT ?',
      [limit],
    );
    return { commits };
  },
});

export const doltTools = { doltQuery, doltWrite, doltHistory };
