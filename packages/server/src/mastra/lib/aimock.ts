import { env } from '../../lib/env';

/**
 * Routes LLM provider calls through AIMock when USE_AIMOCK=true.
 *
 * MUST be called before any Mastra agent or @ai-sdk/* client is constructed.
 * The Vercel AI SDK reads provider base URLs from env at client instantiation
 * and caches them — late overrides will silently hit the real APIs.
 *
 * Idempotent. Safe to call multiple times.
 */
export function configureAIMock(): void {
  if (!env.USE_AIMOCK) return;

  const base = env.AIMOCK_URL.replace(/\/$/, '');

  // OpenAI
  process.env.OPENAI_BASE_URL = `${base}/v1`;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'mock';

  // Anthropic — @ai-sdk/anthropic appends /messages to ANTHROPIC_BASE_URL,
  // so set it to {base}/v1 so requests land at /v1/messages (AIMock's path).
  process.env.ANTHROPIC_BASE_URL = `${base}/v1`;
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'mock';

  // Google Gemini
  process.env.GOOGLE_GENERATIVE_AI_BASE_URL = base;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? 'mock';

  if (env.LOG_LEVEL === 'debug') {
    console.log(`🎭 AIMock active — LLM calls routed to ${base}`);
  }
}
