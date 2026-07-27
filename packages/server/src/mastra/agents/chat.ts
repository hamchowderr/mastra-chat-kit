import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { TaskSignalProvider } from '@mastra/core/signals';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { env } from '../../lib/env';
import { putImage } from '../lib/image-store';
import { createDefaultMemory } from '../lib/memory';
import { defaultInputProcessors, defaultOutputProcessors } from '../lib/processors';
import { getChatWorkspace } from '../lib/workspace';
import { listSchedules, startSchedule, stopSchedule } from '../tools/schedule';

/**
 * # Chat Assistant (mastra-chat-kit reference agent)
 *
 * A general conversational agent whose only job is to exercise the full chat UI
 * surface: streamed text, reasoning, tool input/output rendering, and sources.
 * Both Agent mode (`handleChatStream` / `chatRoute`) and Harness mode drive THIS
 * agent — the UI stays identical; only the transport changes.
 *
 * Endpoint (Agent mode): POST /chat/chat   (registered via chatRoute in index.ts)
 *
 * Demo tools are deterministic so AIMock fixtures can drive them with zero spend.
 */

/** Instant tool → exercises <Tool>/<ToolInput>/<ToolOutput> rendering. */
export const getWeather = createTool({
  id: 'getWeather',
  description:
    'Get the current weather for a location. Call this whenever the user asks about weather.',
  inputSchema: z.object({
    location: z.string().describe('City name, e.g. "Los Angeles"'),
  }),
  outputSchema: z.object({
    location: z.string(),
    temperatureC: z.number(),
    condition: z.string(),
  }),
  execute: async ({ location }) => {
    // Deterministic pseudo-weather derived from the location string so the same
    // input always yields the same output (AIMock-friendly).
    const seed = [...location].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const conditions = ['Sunny', 'Cloudy', 'Rainy', 'Windy', 'Clear'];
    return {
      location,
      temperatureC: 10 + (seed % 20),
      condition: conditions[seed % conditions.length],
    };
  },
});

/** Returns documents → exercises sources/citation rendering in the UI. */
export const searchKnowledge = createTool({
  id: 'searchKnowledge',
  description:
    'Search the knowledge base for documents relevant to a query. Use when the user asks a factual or how-to question.',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      }),
    ),
  }),
  execute: async ({ query }) => ({
    results: [
      {
        title: `Overview: ${query}`,
        url: `https://docs.example.com/${encodeURIComponent(query)}`,
        snippet: `A concise overview covering ${query} and how it works.`,
      },
      {
        title: `Guide: getting started with ${query}`,
        url: `https://docs.example.com/${encodeURIComponent(query)}/guide`,
        snippet: `Step-by-step guide for ${query}, with examples.`,
      },
    ],
  }),
});

/**
 * Generates a real image via OpenAI's image API → exercises the <Image> element
 * with model-produced output. Cross-provider on purpose: the chat model (e.g.
 * Claude) decides to call this; the tool itself hits OpenAI's image endpoint.
 */
export const generateImage = createTool({
  id: 'generateImage',
  description:
    'Generate an image from a text prompt. Call this whenever the user asks for an image, picture, drawing, or illustration.',
  inputSchema: z.object({
    prompt: z.string().describe('A vivid description of the image to generate'),
  }),
  outputSchema: z.object({
    imageId: z.string(),
    mediaType: z.string(),
    prompt: z.string(),
  }),
  execute: async ({ prompt }) => {
    const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    // Keep the output SMALL: a 1024x1024 PNG base64 (~2MB) would overflow the
    // model's context on the continuation step. WebP + low quality + compression
    // yields ~30-60KB, which flows through the agent + memory cleanly.
    const res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1-mini',
        prompt,
        size: '1024x1024',
        quality: 'low',
        output_format: 'webp',
        output_compression: 40,
        n: 1,
      }),
    });
    if (!res.ok) {
      throw new Error(`image generation failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const base64 = json.data?.[0]?.b64_json ?? '';
    // Stash the bytes server-side; hand the model only a tiny id (served via
    // GET /images/:id), so the image never enters the model context.
    const imageId = randomUUID();
    putImage(base64, 'image/webp', imageId);
    return { imageId, mediaType: 'image/webp', prompt };
  },
});

/**
 * Lets the agent set its OWN objective when it recognizes the user wants a standing
 * goal to work toward over several turns — the agentic-native way to start a goal-
 * driven run (no UI button). Writes the objective to the current thread's durable
 * state via `setObjective`; the agent's `goal` config then judges each turn and loops
 * until it passes or the run budget is hit (emitting `goal_evaluation` → the GoalCard).
 * Resolves the runtime agent (with the harness storage propagated) from the tool
 * context, falling back to the module singleton.
 */
export const setGoal = createTool({
  id: 'setGoal',
  description:
    'Set a persistent objective to work toward over multiple turns. Call this when the user asks you to keep working until something is achieved, gives you a standing goal, or wants iterative refinement ("keep going until…", "your goal is…", "don\'t stop until…", "iterate until it\'s good"). Do NOT call it for one-shot requests. After calling it, start working — a judge scores each turn and you keep going until the goal is met.',
  inputSchema: z.object({
    objective: z.string().describe('A crisp, verifiable restatement of the goal to work toward.'),
    maxRuns: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Optional cap on judged iterations before the goal stops (defaults to the agent config).',
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    objective: z.string(),
    status: z.string(),
    maxRuns: z.number().optional(),
  }),
  execute: async ({ objective, maxRuns }, ctx) => {
    const threadId = ctx?.agent?.threadId;
    const resourceId = ctx?.agent?.resourceId;
    // Resolve the RUNNING agent by id from the tool context's Mastra — its storage is the
    // harness store the in-loop goal step reads back. Resolving by id (not by importing
    // `chatAgent`) also avoids a tool⇄agent circular reference. `setObjective` no-ops
    // without a memory-backed thread, so guard on threadId + a resolved agent.
    const agent = ctx?.mastra?.getAgent(ctx?.agent?.agentId ?? 'chat');
    if (!threadId || !agent) {
      return { ok: false, objective, status: 'unavailable' };
    }
    const record = await agent.setObjective(objective, {
      threadId,
      ...(resourceId ? { resourceId } : {}),
      ...(typeof maxRuns === 'number' && maxRuns > 0 ? { maxRuns } : {}),
    });
    return {
      ok: true,
      objective: record?.objective ?? objective,
      status: record?.status ?? 'active',
      ...(record?.maxRuns ? { maxRuns: record.maxRuns } : {}),
    };
  },
});

const BASE_INSTRUCTIONS = `You are a helpful, concise assistant.

- When the user asks about weather, call getWeather.
- When the user asks a factual or how-to question, call searchKnowledge and ground your answer in the results, citing the document titles.
- When the user asks for an image, picture, drawing, or illustration, call generateImage with a vivid prompt.
- For substantial, self-contained work, delegate to a specialist subagent via the subagent tool rather than doing it inline (Harness mode only). Pick the agentType by the task: "code" for building/editing/running code and tests in the sandbox; "research" for open-ended "find out / look up / compare / what's the latest" questions that need live web browsing + sources; "writer" for drafting long-form content (docs, summaries, posts, explanations). A subagent can't see this conversation, so put ALL the context it needs in the task. Handle small, quick things yourself.
- When the user gives you a STANDING objective to work toward over multiple turns — "keep going until…", "your goal is…", "don't stop until…", "iterate until it's good" — call setGoal with a crisp, verifiable restatement, then start working. A judge scores each turn and you keep iterating until it's met. Do NOT call setGoal for ordinary one-shot requests; just answer those.
- For a task that is complex, multi-step, ambiguous, or risky (touches many files, changes or deletes things, or where getting the approach wrong is costly), PLAN FIRST: briefly research if needed, then call submit_plan with a short, ordered plan and wait for approval before doing the work. Don't plan for simple, one-shot, or read-only requests — just do those directly. (submit_plan is only available in Harness mode.)
- When you need something from the user that you don't have and can't sensibly assume — a genuinely ambiguous request (which of several things they mean) OR a required detail that's missing (a name, value, or choice you can't default) — ALWAYS ask through the ask_user tool, NEVER in plain prose. (A plain-text question just stalls the turn; ask_user gives the user a real prompt that resumes the run with their answer.) Call ask_user with ONE clear, specific question, and pass \`options\` (2–4 concise labels) when the likely answers are known so the user can pick instead of typing. Ask once, then continue with the answer. Don't use it for things you can reasonably infer or default — for trivial gaps, act on a sensible assumption and say what you assumed. (ask_user is only available in Harness mode.)
- For a task with several distinct steps, track it with the task tools: call task_write once to lay out the steps up front, then task_update / task_complete as you finish each one, so the user can watch progress. Skip this for single-step or trivial requests — don't narrate a one-liner as a task list.
- When the user wants something to happen repeatedly on a timer — "every morning…", "remind me every hour…", "run X daily…" — call start_schedule with a cron expression and the prompt to run; it returns a schedule id and fires into this conversation. To stop or cancel one, call stop_schedule with its id (use list_schedules first if you don't have it). Use these only for genuinely recurring requests, not one-off "do this now" tasks. (Scheduling is only available in Harness mode.)
- Keep responses tight and skimmable. Use markdown (lists, code blocks) where it helps.
- Never fabricate tool results; only state what the tools return.`;

// Appended when the composer's "Search" toggle is on. The Harness path passes
// `webSearch: true` on the request context (see /harness/stream), and in that path
// the agent has real workspace browser tools — the SAME Chrome the Browser panel
// screencasts — so web search is routed THROUGH the browser: it navigates the live
// web and reads pages rather than answering from memory. The Single Agent path uses
// provider-executed web_search instead and never sets this key, so this only applies
// in Harness mode.
const WEB_SEARCH_INSTRUCTIONS = `

The user has enabled web search for this turn. Use your browser tools to look things up on the live web:
- Navigate to relevant pages and read them before answering anything time-sensitive, factual, or about current events.
- Prefer real browsing over your training data, and cite the URLs you actually visited.
- The user can watch you browse in the Browser panel, so keep your navigation purposeful.`;

export const chatAgent = new Agent({
  id: 'chat',
  name: 'Chat Assistant',
  description:
    'General conversational assistant that exercises the full chat UI: streamed text, reasoning, tool input/output, sources, and images. The reference agent for mastra-chat-kit.',
  // Dynamic so the Harness "Search" toggle (request context `webSearch`) can switch
  // the agent into browse-the-web mode. Static string otherwise.
  instructions: ({ requestContext }) =>
    requestContext.get('webSearch') === true
      ? BASE_INSTRUCTIONS + WEB_SEARCH_INSTRUCTIONS
      : BASE_INSTRUCTIONS,
  model: env.CHAT_MODEL,
  // Native goal mechanism (flagship harness demo). Configuring `goal` auto-registers
  // the goal signal provider + the in-loop goal step: an objective set via
  // `agent.setObjective({ threadId })` is judged after each turn by this judge model,
  // and the agent keeps working until the judge passes it or the run budget (maxRuns)
  // is hit — emitting `goal_evaluation` events the web folds into a goal card. Inert
  // until an objective is set, so ordinary chats are unaffected. The judge defaults to
  // the chat model; the /harness/goal route overrides per-objective (judgeModelId /
  // maxRuns). Requires memory (below) + a thread/resource, which the harness supplies.
  goal: { judge: env.CHAT_MODEL },
  // Native multi-step task tracking (harness parity). One registration bundles the
  // four task tools (task_write/update/complete/check) AND the TaskStateProcessor that
  // keeps the list alive across turns — emitting `task_updated` → the <Task> element.
  // This gives the SINGLE-AGENT path task tracking too (the Harness path also exposes
  // task tools via the controller; the agent's provider is the canonical source and
  // dedupes by tool id). Needs memory + a thread, which both paths supply.
  signals: [new TaskSignalProvider()],
  // The SHARED workspace (filesystem + sandbox + browser) so Mastra Studio surfaces it +
  // its tools on this registered agent (698.31), matching the official template. Always on
  // — it's core to the kit, not a user option. It's a DynamicArgument so the UNGATED
  // Single-Agent /chat transport can opt OUT per request (it sets `noWorkspace` in the
  // request context) — otherwise that simple path would expose fs/shell tools with NO
  // approval — and so the AIMock suite (NODE_ENV=test) stays hermetic (the harness
  // controller supplies its own workspace there). In Harness mode the controller shares
  // THIS same instance (getChatWorkspace), so it's not double-provisioned, and every tool
  // is HITL-gated there.
  workspace: ({ requestContext }) =>
    env.NODE_ENV !== 'test' && requestContext?.get('noWorkspace') !== true
      ? getChatWorkspace()
      : undefined,
  tools: {
    getWeather,
    searchKnowledge,
    generateImage,
    setGoal,
    startSchedule,
    stopSchedule,
    listSchedules,
  },
  // Default execution options applied to EVERY run (chatRoute + Harness): enable
  // Anthropic extended thinking so the model emits real `reasoning` parts (→ the
  // <Reasoning> element). Thinking requires temperature 1. Ignored by non-Anthropic
  // providers, so it's safe regardless of CHAT_MODEL.
  defaultOptions: {
    modelSettings: { temperature: 1 },
    providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1500 } } },
  },
  memory: createDefaultMemory(),
  inputProcessors: defaultInputProcessors,
  outputProcessors: defaultOutputProcessors,
});
