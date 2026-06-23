import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createDefaultMemory } from '../lib/memory';
import { defaultInputProcessors, defaultOutputProcessors } from '../lib/processors';
import { hallucinationScorer, urgencyScorer } from '../scorers/_example.scorers';

/**
 * # Lead Intake Agent (canonical example)
 *
 * What it does:
 *   Takes unstructured text (email body, voice transcript, form submission)
 *   and returns structured lead data validated against LeadSchema.
 *
 * Who calls it:
 *   - n8n / Make webhook
 *   - Next.js API route
 *   - VAPI/LiveKit tool callback
 *   Endpoint: POST /api/agents/leadIntake/generate
 *
 * Env vars required:
 *   - ANTHROPIC_API_KEY (default model)
 *
 * How to test:
 *   curl -X POST http://localhost:4111/api/agents/leadIntake/generate \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "messages": [{
 *         "role": "user",
 *         "content": "Hi, this is John from Acme Corp (john@acme.io). We need pricing for 50 seats by Friday."
 *       }]
 *     }'
 *
 * Copy this file, rename, and adapt for new agents.
 */

export const LeadSchema = z.object({
  name: z.string().nullable().describe('Full name of the lead, or null if not found'),
  email: z.string().nullable().describe('Email address, or null'),
  company: z.string().nullable().describe('Company name, or null'),
  intent: z
    .enum(['demo', 'pricing', 'support', 'partnership', 'other'])
    .describe('What the lead wants'),
  urgency: z.enum(['low', 'medium', 'high']).describe('Tone-based urgency'),
  notes: z.string().describe('One-sentence summary of context'),
});

export type Lead = z.infer<typeof LeadSchema>;

const validateEmail = createTool({
  id: 'validateEmail',
  description: 'Validate and normalize an email address',
  inputSchema: z.object({ email: z.string().nullable() }),
  outputSchema: z.object({
    valid: z.boolean(),
    normalized: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  execute: async ({ email }) => {
    if (!email) return { valid: false, normalized: null, reason: 'No email provided' };
    const result = z.string().email().safeParse(email.trim().toLowerCase());
    if (!result.success) {
      return {
        valid: false,
        normalized: null,
        reason: result.error.issues[0]?.message ?? 'Invalid email format',
      };
    }
    return { valid: true, normalized: result.data, reason: null };
  },
});

export const leadIntakeAgent = new Agent({
  id: 'leadIntake',
  name: 'Lead Intake',
  description:
    'Extracts structured contact and intent data from inbound lead messages. Returns email, phone, name, summary, and urgency rating.',
  instructions: `You extract structured lead information from unstructured text.

Inputs may be email bodies, voice transcripts, or form submissions.

Rules:
- If a field is not present, return null. Never guess or fabricate.
- When you find an email address, call validateEmail to confirm it parses cleanly.
- The notes field is one short sentence summarizing what the lead actually wants.
- Urgency reflects tone: explicit deadlines or frustration → high; "would love to learn more" → low; default → medium.

Output rules (strictly enforced):
- Your response is ONLY the JSON object. Nothing else.
- Never write any text before or after the JSON — no "Let me...", no "Got it!", no "Here is...", no commentary of any kind.
- Never narrate tool calls. Call tools silently; they produce no visible output to the user.
- If information is missing, still return the JSON with null fields. Do not ask follow-up questions.`,
  model: 'anthropic/claude-sonnet-4-6',
  tools: { validateEmail },
  memory: createDefaultMemory(),
  // Shared safety/hygiene baseline (UnicodeNormalizer + TokenLimiter active;
  // model-backed guardrails are opt-in — see src/mastra/lib/processors.ts).
  inputProcessors: defaultInputProcessors,
  outputProcessors: defaultOutputProcessors,
  scorers: {
    hallucination: {
      scorer: hallucinationScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    urgency: {
      scorer: urgencyScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
});
