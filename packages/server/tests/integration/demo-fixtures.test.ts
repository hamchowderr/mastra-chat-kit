import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentController, Session } from '@mastra/core/agent-controller';
import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The live-demo flows (docs/demo.md) resolve to THEIR OWN fixtures — every hop,
 * not just the first — and never to the catch-all.
 *
 * Proof comes from AIMock itself: its journal records which fixture served each
 * request. A flow that silently fell through to the catch-all would still "work"
 * (the catch-all answers anything), so asserting on the reply text alone would
 * miss exactly the failure that matters on stage.
 *
 * Runs in the DEV shape the demo runs in, not the test shape: NODE_ENV is stubbed
 * to development before the source modules load, so the chat agent carries its
 * workspace (the plan and code flows call workspace tools on the MAIN agent, which
 * under NODE_ENV=test would be ToolNotFoundError). USE_AIMOCK stays on, which is
 * also what keeps observational memory off — asserted below.
 */

const AIMOCK = 'http://127.0.0.1:4010';
const CATCH_ALL = "I'm the mastra-chat-kit reference assistant";

type Fixture = { match: Record<string, unknown>; response: Record<string, unknown> };
type Entry = {
  path: string;
  body: { messages?: Array<{ role: string; content: unknown }> } | null;
  response: { status: number; fixture: Fixture | null };
};

let root: string;
let controller: AgentController;
let mastra: Mastra;
let AUTO_ALLOWED_TOOLS: readonly string[] = [];

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'chat-kit-demo-'));
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('WORKSPACE_ROOT', root);
  // Dynamic imports: env.ts reads process.env once, when it first loads.
  const { chatAgent } = await import('../../src/mastra/agents/chat');
  const ac = await import('../../src/mastra/lib/agent-controller');
  AUTO_ALLOWED_TOOLS = ac.AUTO_ALLOWED_TOOLS;
  const { createChatAgentController } = ac;
  const { getChatWorkspace } = await import('../../src/mastra/lib/workspace');
  // The live wiring: ONE shared workspace (filesystem + sandbox + a lazy browser that
  // never launches here) on both the chat agent and the controller.
  controller = createChatAgentController({
    storage: new InMemoryStore(),
    resourceId: 'u-demo',
    workspace: getChatWorkspace(),
  });
  // Registered on a Mastra so start_schedule has `ctx.mastra.schedules`, as in the app.
  mastra = new Mastra({
    agents: { chat: chatAgent },
    agentControllers: { chat: controller },
    storage: new InMemoryStore(),
  });
  await controller.init();
}, 60_000);

afterAll(async () => {
  await controller?.destroy();
  await mastra?.shutdown();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

/**
 * Drive one demo flow on a fresh thread, the way the presenter does: approve every
 * gate, answer ask_user with `answer`, approve the plan. Returns the controller
 * events and the AIMock journal entries the flow produced.
 */
async function runFlow(prompt: string, opts: { answer?: string } = {}) {
  await fetch(`${AIMOCK}/__aimock/reset/journal`, { method: 'POST' });
  const session: Session = await controller.createSession({ resourceId: 'u-demo' });
  // The live session's grants (getChatSession).
  for (const tool of AUTO_ALLOWED_TOOLS) {
    session.grantTool(tool);
  }
  // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide
  const events: any[] = [];
  let suspended: { toolName: string; toolCallId: string } | null = null;
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    if (event.type === 'tool_approval_required') {
      session.respondToToolApproval({ decision: 'approve' });
    }
    if (event.type === 'tool_suspended') {
      suspended = { toolName: event.toolName, toolCallId: event.toolCallId };
    }
  });

  await session.thread.create();
  const run = session.sendMessage({ content: prompt });
  // A suspension (ask_user, submit_plan) parks the run; answer it like the UI does.
  for (let hop = 0; hop < 4; hop++) {
    const settled = await Promise.race([
      run.then(() => 'done' as const),
      until(() => suspended !== null).then(() => 'suspended' as const),
    ]);
    if (settled === 'done' && suspended === null) break;
    const current = suspended as { toolName: string; toolCallId: string } | null;
    if (!current) break;
    suspended = null;
    await session.respondToToolSuspension({
      toolCallId: current.toolCallId,
      resumeData:
        current.toolName === 'submit_plan' ? { action: 'approved' } : (opts.answer ?? 'Playful'),
    });
  }
  await run.catch(() => {});
  // Let the background title generation land in the journal too.
  await new Promise((r) => setTimeout(r, 300));
  unsubscribe();

  const journal = (await (await fetch(`${AIMOCK}/__aimock/journal`)).json()) as Entry[];
  return { events, journal };
}

/** Fixtures that served this flow's model calls (images and titles included). */
const served = (journal: Entry[]) => journal.map((e) => e.response.fixture);

function expectNoFallThrough(journal: Entry[]) {
  expect(journal.length).toBeGreaterThan(0);
  for (const e of journal) {
    expect(e.response.status, `${e.path} was not served`).toBe(200);
    const f = e.response.fixture;
    expect(f, `${e.path} matched no fixture`).not.toBeNull();
    expect(JSON.stringify(f?.response)).not.toContain(CATCH_ALL);
  }
}

/** Every hop id in `ids` served a request: the whole chain ran, not just its head. */
function expectHops(journal: Entry[], ids: string[]) {
  const hit = new Set(
    served(journal)
      .map((f) => f?.match.toolCallId)
      .filter(Boolean),
  );
  for (const id of ids) expect(hit, `hop after ${id} never ran`).toContain(id);
}

const text = (events: unknown[]) => JSON.stringify(events);

describe('demo flows resolve to their own fixtures (docs/demo.md)', () => {
  it('1. plan → approve → task checklist → briefing', async () => {
    const { events, journal } = await runFlow(
      'Plan a weather briefing for Tokyo, Paris and New York, then carry it out.',
    );
    expectNoFallThrough(journal);
    expectHops(journal, [
      'toolu_demo_plan_write',
      'toolu_demo_plan_submit',
      'toolu_demo_plan_t1',
      'toolu_demo_plan_w1',
      'toolu_demo_plan_t2',
      'toolu_demo_plan_w2',
      'toolu_demo_plan_t3',
      'toolu_demo_plan_w3',
      'toolu_demo_plan_t4',
    ]);
    expect(readFileSync(path.join(root, 'plans/weather-briefing.md'), 'utf8')).toContain('Tokyo');
    const tasks = events.filter((e) => e.type === 'task_updated');
    expect(tasks.at(-1)?.tasks.every((t: { status: string }) => t.status === 'completed')).toBe(
      true,
    );
    // The briefing quotes getWeather's real output for the three cities.
    expect(text(events)).toContain('"temperatureC":24');
    expect(text(events)).toContain('Weather briefing');
  });

  it('2. code subagent writes and runs fizzbuzz.js; the parent re-runs it', async () => {
    const { events, journal } = await runFlow(
      'Have the code subagent build a FizzBuzz script and run it.',
    );
    expectNoFallThrough(journal);
    expectHops(journal, [
      'toolu_demo_code_write',
      'toolu_demo_code_run',
      'toolu_demo_code_subagent',
      'toolu_demo_code_verify',
    ]);
    expect(readFileSync(path.join(root, 'fizzbuzz.js'), 'utf8')).toContain('FizzBuzz');
    // Real execution: "14\nFizzBuzz" appears only in the command's output.
    expect(text(events)).toContain('14\\nFizzBuzz');
    expect(events.some((e) => e.type === 'subagent_end')).toBe(true);
  });

  it('3. ask_user: the reply follows the option picked', async () => {
    const playful = await runFlow("Draft a one-line announcement for tonight's meetup.", {
      answer: 'Playful',
    });
    expectNoFallThrough(playful.journal);
    expect(text(playful.events)).toContain('What tone should the announcement have?');
    expect(text(playful.events)).toContain('one very brave demo');

    const pro = await runFlow("Draft a one-line announcement for tonight's meetup.", {
      answer: 'Professional',
    });
    expectNoFallThrough(pro.journal);
    expect(text(pro.events)).toContain('followed by Q&A');
  });

  it('4. image generation returns a real PNG', async () => {
    const { events, journal } = await runFlow('Generate an image of a sunset over the mountains.');
    expectNoFallThrough(journal);
    expectHops(journal, ['toolu_demo_image']);
    expect(journal.some((e) => e.path.endsWith('/images/generations'))).toBe(true);
    expect(text(events)).toContain('"mediaType":"image/png"');
  });

  it('5. schedules: a weekday reminder is created and listed', async () => {
    const { journal } = await runFlow('Every weekday at 9am, remind me to post my standup update.');
    expectNoFallThrough(journal);
    expectHops(journal, ['toolu_demo_schedule']);
    const rows = await mastra.schedules.list({ agentId: 'chat' });
    // biome-ignore lint/suspicious/noExplicitAny: AnySchedule union
    expect(rows.some((s: any) => s.cron === '0 9 * * 1-5' && s.status === 'active')).toBe(true);
  });

  it('6. research: two searches and a cited answer, no network', async () => {
    const { events, journal } = await runFlow(
      'Research what the AgentController does and cite your sources.',
    );
    expectNoFallThrough(journal);
    expectHops(journal, ['toolu_demo_research_1', 'toolu_demo_research_2']);
    expect(text(events)).toContain('Overview: AgentController tool approvals');
    // Every request this flow made went to AIMock's model/image endpoints — no browser.
    expect(text(events)).not.toContain('browser');
  });

  it('the scheduled prompt has its own fixture if the schedule ever fires', async () => {
    const { journal } = await runFlow('Remind me to post my standup update.');
    expectNoFallThrough(journal);
  });

  // OM's Observer can't be played by a mock: in resource scope it must answer with
  // <thread id="…"> blocks keyed by LIVE thread ids, and its request replays the
  // conversation, so it substring-matches these very fixtures and gets their tool calls
  // back. Checked both ways, in the dev shape the demo runs in.
  it('observational memory is off under USE_AIMOCK, and on without it', async () => {
    const { createDefaultMemory } = await import('../../src/mastra/lib/memory');
    expect(await createDefaultMemory().omEngine).toBeNull();

    vi.resetModules();
    vi.stubEnv('USE_AIMOCK', 'false');
    const fresh = await import('../../src/mastra/lib/memory');
    expect(await fresh.createDefaultMemory().omEngine).not.toBeNull();
    vi.stubEnv('USE_AIMOCK', 'true');
  });
});

async function until(pred: () => boolean, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
