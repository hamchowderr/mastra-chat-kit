import { createScorer } from '@mastra/core/evals';
import {
  createHallucinationScorer,
  createPromptAlignmentScorerLLM,
} from '@mastra/evals/scorers/prebuilt';
import {
  getAssistantMessageFromRunOutput,
  getUserMessageFromRunInput,
} from '@mastra/evals/scorers/utils';
import { z } from 'zod';

export const hallucinationScorer = createHallucinationScorer({
  model: 'anthropic/claude-sonnet-4-6',
});

export const promptAlignmentScorer = createPromptAlignmentScorerLLM({
  model: 'anthropic/claude-sonnet-4-6',
});

export const urgencyScorer = createScorer({
  id: 'lead-urgency-scorer',
  name: 'Lead Urgency',
  description: 'Verifies the agent inferred urgency level correctly from tone',
  type: 'agent',
  judge: {
    model: 'anthropic/claude-sonnet-4-6',
    instructions:
      'You evaluate whether an AI agent correctly inferred urgency from the tone of a lead message. ' +
      'High urgency = explicit deadline, frustration, "URGENT", "production down", "now", etc. ' +
      'Low urgency = casual phrasing, "no rush", "curious", exploratory tone. ' +
      'Medium = default; neither explicit urgency nor explicit casual.',
  },
})
  .preprocess(({ run }) => {
    const userText = getUserMessageFromRunInput(run.input) ?? '';
    const assistantText = getAssistantMessageFromRunOutput(run.output) ?? '';
    return { userText, assistantText };
  })
  .analyze({
    description: 'Determine if urgency in output matches urgency in input tone',
    outputSchema: z.object({
      expectedUrgency: z.enum(['low', 'medium', 'high']),
      reportedUrgency: z.enum(['low', 'medium', 'high']),
      match: z.boolean(),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => `
Evaluate urgency inference.

User message:
"""
${results.preprocessStepResult.userText}
"""

Agent response (JSON):
"""
${results.preprocessStepResult.assistantText}
"""

Tasks:
1. Determine the correct urgency from the user's tone.
2. Extract what urgency the agent reported (look for "urgency": "..." in the JSON).
3. Set match=true only if they agree.

Return JSON: { expectedUrgency, reportedUrgency, match, explanation }
`,
  })
  .generateScore(({ results }) => {
    return results.analyzeStepResult?.match ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r = results.analyzeStepResult;
    return `Expected: ${r?.expectedUrgency ?? '?'}, Reported: ${r?.reportedUrgency ?? '?'}. Score=${score}. ${r?.explanation ?? ''}`;
  });
