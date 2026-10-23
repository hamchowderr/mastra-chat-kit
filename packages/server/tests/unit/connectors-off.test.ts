import { describe, expect, it } from 'vitest';
import { MAX_CONNECTORS_OFF, readConnectorsOff } from '../../src/mastra/lib/connectors-off';
import { streamBodySchema } from '../../src/mastra/routes/stream-body';

/**
 * The connectors a person turned off for a chat ride each turn. The list comes from the
 * browser's own storage, so anything odd in it is dropped, and never refuses the turn.
 */
describe('connectors turned off for a chat', () => {
  it('keeps lower-case slugs, once each, and drops the rest', () => {
    expect(
      readConnectorsOff(['gmail', 'slack', 'gmail', 'Bad Name', 42, '', 'x'.repeat(65)]),
    ).toEqual(['gmail', 'slack']);
    expect(readConnectorsOff([])).toBeUndefined();
    expect(readConnectorsOff('gmail')).toBeUndefined();
    expect(readConnectorsOff(undefined)).toBeUndefined();
  });

  it('reads at most the cap', () => {
    const many = Array.from({ length: MAX_CONNECTORS_OFF + 5 }, (_, i) => `app${i}`);
    expect(readConnectorsOff(many)).toHaveLength(MAX_CONNECTORS_OFF);
  });

  it('rides the stream body, and an odd list never refuses the turn', () => {
    expect(streamBodySchema.parse({ text: 'hi', connectorsOff: ['gmail'] }).connectorsOff).toEqual([
      'gmail',
    ]);
    const odd = streamBodySchema.safeParse({ text: 'hi', connectorsOff: { a: 1 } });
    expect(odd.success).toBe(true);
    expect(odd.data?.connectorsOff).toBeUndefined();
  });
});
