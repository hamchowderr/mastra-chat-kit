import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { env } from '../../lib/env';
import { putImage } from '../lib/image-store';
import { createDefaultMemory } from '../lib/memory';
import { defaultInputProcessors, defaultOutputProcessors } from '../lib/processors';

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

const BASE_INSTRUCTIONS = `You are a helpful, concise assistant.

- When the user asks about weather, call getWeather.
- When the user asks a factual or how-to question, call searchKnowledge and ground your answer in the results, citing the document titles.
- When the user asks for an image, picture, drawing, or illustration, call generateImage with a vivid prompt.
- For substantial multi-step coding or build tasks — creating/editing files, running code, running tests — delegate to the code subagent via the subagent tool (agentType: "code") rather than doing it inline. (Only available in Harness mode; handle small snippets yourself.)
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
  tools: { getWeather, searchKnowledge, generateImage },
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
