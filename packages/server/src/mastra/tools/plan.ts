import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { planDirFor } from '../routes/resource';

/** The resource id a run belongs to when no user is known (the one shared user). */
const SHARED_RESOURCE = 'chat-kit-user';

/** A short, filesystem-safe slug from a plan title (may be empty for non-Latin titles). */
export function planSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** A new plan file name: the slug for humans, a random id so two plans never collide. */
export function newPlanFileName(title: string, id: string = randomUUID().slice(0, 8)): string {
  const slug = planSlug(title);
  return `${slug ? `${slug}-` : 'plan-'}${id}.md`;
}

/**
 * `write_plan` — the one way to write a file in `plans` workspace mode.
 *
 * The built-in `submit_plan` takes the PATH of a plan file, and the Plan card reads that
 * file through `/workspace/file`. In `plans` mode every workspace tool is hidden, so the
 * agent writes its plan with this instead. It can only write Markdown into the run's
 * user's own folder (`plans/u-<hash>/`, see `planDirFor`), so users never see or
 * overwrite each other's plans. A new plan gets a fresh file; passing back the `path`
 * it returned revises that same file. Writing a draft plan changes nothing the user
 * cares about — approving the plan is the decision — so it runs without an approval
 * card (AUTO_ALLOWED_TOOLS).
 */
export function createWritePlanTool(root: string) {
  return createTool({
    id: 'write_plan',
    description:
      'Write your plan as Markdown to a plan file, then call submit_plan with the path this returns. To revise a plan, pass the same path back.',
    inputSchema: z.object({
      title: z.string().min(1).describe('A short title for the plan, e.g. "Grant application"'),
      plan: z.string().min(1).describe('The plan in Markdown: a short ordered list of steps'),
      path: z
        .string()
        .optional()
        .describe('The path an earlier write_plan returned, to revise that plan'),
    }),
    outputSchema: z.object({ path: z.string() }),
    execute: async ({ title, plan, path: revise }, ctx) => {
      const dir = planDirFor(ctx?.agent?.resourceId || SHARED_RESOURCE);
      // Only a file in this user's own folder can be revised; anything else is a new plan.
      const rel =
        revise && path.posix.dirname(path.posix.normalize(revise)) === dir && revise.endsWith('.md')
          ? path.posix.normalize(revise)
          : `${dir}/${newPlanFileName(title)}`;
      const abs = path.join(root, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, `# ${title}\n\n${plan.trim()}\n`, 'utf8');
      return { path: rel };
    },
  });
}
