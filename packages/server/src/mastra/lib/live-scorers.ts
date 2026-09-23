import { checks } from '@mastra/evals/checks';
import { createAnswerRelevancyScorer } from '@mastra/evals/scorers/prebuilt';
import { env } from '../../lib/env';

/**
 * Live scoring on the chat agent: scores run in the background after each reply
 * (they never slow the response) and land in the scores store, next to the run's
 * trace in Studio.
 *
 * - noToolErrors on every reply: a Quick Check, no LLM call, free.
 * - answer relevancy on 10% of replies: an LLM judge (up to 3 judge calls per
 *   scored reply). Its model is CHAT_MODEL, so it bills to the project's one model
 *   key. Off under NODE_ENV=test or USE_AIMOCK: a mocked model can't produce the judge's
 *   structured output (STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED), and a mock's verdict
 *   would mean nothing anyway.
 */
export const liveScorers = {
  noToolErrors: {
    scorer: checks.noToolErrors(),
    sampling: { type: 'ratio' as const, rate: 1 },
  },
  ...(env.NODE_ENV !== 'test' && !env.USE_AIMOCK
    ? {
        answerRelevancy: {
          scorer: createAnswerRelevancyScorer({ model: env.CHAT_MODEL }),
          sampling: { type: 'ratio' as const, rate: 0.1 },
        },
      }
    : {}),
};
