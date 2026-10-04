import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/** Plan files live here, relative to the workspace root. */
export const PLANS_DIR = 'plans';

/** A short, filesystem-safe file name from a plan title. */
export function planFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'plan'}.md`;
}

/**
 * `write_plan` — the one way to write a file in `plans` workspace mode.
 *
 * The built-in `submit_plan` takes the PATH of a plan file, and the Plan card reads that
 * file through `/workspace/file`. In `plans` mode every workspace tool is hidden, so the
 * agent writes its plan with this instead: it can only create or replace a Markdown file
 * under `plans/`, and returns the path to hand to `submit_plan`. Writing a draft plan
 * changes nothing the user cares about — approving the plan is the decision — so it runs
 * without an approval card (AUTO_ALLOWED_TOOLS).
 */
export function createWritePlanTool(root: string) {
  return createTool({
    id: 'write_plan',
    description:
      'Write your plan as Markdown to a plan file, then call submit_plan with the path this returns. Reuse the same title to revise a plan.',
    inputSchema: z.object({
      title: z.string().min(1).describe('A short title for the plan, e.g. "Grant application"'),
      plan: z.string().min(1).describe('The plan in Markdown: a short ordered list of steps'),
    }),
    outputSchema: z.object({ path: z.string() }),
    execute: async ({ title, plan }) => {
      const rel = `${PLANS_DIR}/${planFileName(title)}`;
      const abs = path.join(root, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, `# ${title}\n\n${plan.trim()}\n`, 'utf8');
      return { path: rel };
    },
  });
}
