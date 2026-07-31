import { describe, expect, it } from 'vitest';
import { deriveTitleModelId } from '../../src/mastra/lib/memory';

/**
 * Thread auto-titling must follow the configured provider — hardcoding an Anthropic
 * model silently breaks titles on an OpenAI-only deployment (698.11). deriveTitleModelId
 * is the pure provider-derivation behind `generateTitle.model` / the manual title route.
 */
describe('deriveTitleModelId — provider-appropriate auto-title model', () => {
  it('uses a cheap OpenAI model for an OpenAI chat model (the 698.11 bug)', () => {
    expect(deriveTitleModelId('openai/gpt-4.1-mini')).toBe('openai/gpt-4.1-nano');
  });

  it('uses a cheap Anthropic model for an Anthropic chat model', () => {
    expect(deriveTitleModelId('anthropic/claude-sonnet-4-6')).toBe('anthropic/claude-haiku-4-5');
  });

  it('falls back to the chat model itself for an unrecognized provider', () => {
    // e.g. a Google or custom-router model — reuse the chat model so it still resolves.
    expect(deriveTitleModelId('google/gemini-2.5-flash')).toBe('google/gemini-2.5-flash');
  });
});
