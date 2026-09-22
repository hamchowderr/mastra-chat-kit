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
 *   scored reply). Its model is CHAT_MODEL on purpose: under USE_AIMOCK that model
 *   is mocked, while a separate gateway model id would bypass the mock and bill.
 *   Off under NODE_ENV=test, where AIMock can't produce the judge's structured
 *   output.
 */
export const liveScorers = {
  noToolErrors: {
    scorer: checks.noToolErrors(),
    sampling: { type: 'ratio' as const, rate: 1 },
  },
  ...(env.NODE_ENV !== 'test'
    ? {
        answerRelevancy: {
          scorer: createAnswerRelevancyScorer({ model: env.CHAT_MODEL }),
          sampling: { type: 'ratio' as const, rate: 0.1 },
        },
      }
    : {}),
};
