/**
 * # Default Agent Processors (shared baseline)
 *
 * Spread these into every agent so the whole fleet shares one safety/hygiene
 * baseline instead of each agent reinventing it:
 *
 *   import { defaultInputProcessors, defaultOutputProcessors } from '../lib/processors';
 *
 *   export const myAgent = new Agent({
 *     ...
 *     inputProcessors: defaultInputProcessors,
 *     outputProcessors: defaultOutputProcessors,
 *   });
 *
 * ## What's ACTIVE by default (and why only these two)
 *
 *   - UnicodeNormalizer (input)  — pure string op, no LLM. Strips homoglyph /
 *                                  invisible-char tricks and normalizes whitespace
 *                                  before any other check runs. Zero cost, zero downside.
 *   - TokenLimiter (output)      — deterministic tiktoken count, no LLM. Bounds runaway
 *                                  / costly responses. Generous cap so it never truncates
 *                                  legitimate output — tune per template.
 *
 * Both are deterministic and behavior-neutral: safe to apply to EVERY agent.
 *
 * ## What's OPT-IN (commented below) — and why it is NOT on by default
 *
 * The five model-backed safety processors (Moderation, PromptInjection, PII,
 * Language, SystemPromptScrubber) each construct their own agent and make their
 * own LLM call. Enabling all of them turns one user request into ~6 sequential
 * LLM calls — unacceptable latency for voice/realtime, and a cost multiplier on a
 * lean template. Several behavior-changing processors (StructuredOutput,
 * ToolCallFilter, message-selection, BatchParts, Skills/Workspace/ToolSearch)
 * are also per-agent decisions, not blanket defaults — some directly fight
 * features already wired into the example agent (Memory, structured output,
 * streaming latency).
 *
 * Uncomment + configure the ones a given agent actually needs. See:
 * https://mastra.ai/docs/agents/input-processors and /output-processors
 */

import type { InputProcessorOrWorkflow, OutputProcessorOrWorkflow } from '@mastra/core/processors';
import { TokenLimiter, UnicodeNormalizer } from '@mastra/core/processors';

// import {
//   ModerationProcessor,
//   PromptInjectionDetector,
//   PIIDetector,
//   LanguageDetector,
//   SystemPromptScrubber,
//   ToolCallFilter,
//   StructuredOutputProcessor,
//   BatchPartsProcessor,
// } from '@mastra/core/processors';

/** Generous default output cap. Lower it for chat, raise it for long-form RAG. */
export const DEFAULT_OUTPUT_TOKEN_LIMIT = 8000;

export const defaultInputProcessors: InputProcessorOrWorkflow[] = [
  // Deterministic, no LLM — always safe.
  new UnicodeNormalizer({ stripControlChars: true, collapseWhitespace: true }),

  // --- OPT-IN: model-backed input guardrails (each = one extra LLM call) ---
  // Block jailbreak / prompt-injection before the agent acts:
  // new PromptInjectionDetector({ model: 'anthropic/claude-haiku-4-5' }),
  // Content moderation gate (toxicity / categories):
  // new ModerationProcessor({ model: 'anthropic/claude-haiku-4-5' }),
  // Detect & redact PII on the way in (also valid as an output processor):
  // new PIIDetector({ model: 'anthropic/claude-haiku-4-5', strategy: 'redact' }),
  // Detect / auto-translate input language (skip for data-extraction agents — corrupts source text):
  // new LanguageDetector({ model: 'anthropic/claude-haiku-4-5', targetLanguages: ['English'] }),
];

export const defaultOutputProcessors: OutputProcessorOrWorkflow[] = [
  // Deterministic, no LLM — always safe.
  new TokenLimiter({ limit: DEFAULT_OUTPUT_TOKEN_LIMIT, strategy: 'truncate' }),

  // --- OPT-IN: model-backed / behavior-changing output processors ---
  // Stop system-prompt / instruction leakage in responses (one extra LLM call):
  // new SystemPromptScrubber({ model: 'anthropic/claude-haiku-4-5' }),
  // Redact PII in the response:
  // new PIIDetector({ model: 'anthropic/claude-haiku-4-5', strategy: 'redact' }),
  // Whitelist which tools the model may call (configure with this agent's tools):
  // new ToolCallFilter({ exclude: [] }),
  // Force schema-conformant output (mutually exclusive with free-text agents):
  // new StructuredOutputProcessor({ schema: MySchema, model: 'anthropic/claude-haiku-4-5' }),
  // Smooth streaming by batching chunks (adds time-to-first-token — skip for voice):
  // new BatchPartsProcessor(),
];
