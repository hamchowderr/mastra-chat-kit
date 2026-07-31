import { fastembed } from '@mastra/fastembed';
import { embed } from 'ai';
import { describe, expect, it } from 'vitest';
import { MESSAGE_VECTOR_INDEX } from '../../src/mastra/lib/memory';

/**
 * The embedder that backs semantic recall and the sidebar's chat search.
 *
 * Nothing covered this before. `createDefaultMemory()` wires `embedder: fastembed`
 * unconditionally, but no test touched embeddings, so when the model failed to
 * download in CI — for weeks, silently — every run stayed green while the embedder
 * was completely dead. It surfaced only as a log line ("Failed to probe embedder for
 * dimension, falling back to default") that nothing was reading.
 *
 * These are deliberately cheap: fastembed is a LOCAL ONNX model, so this costs no API
 * spend and needs no network once the model is cached. That is the whole reason the
 * gap was worth closing rather than living with.
 */
describe('fastembed embedder', () => {
  it('produces a 384-dim vector, matching the index the search route queries', async () => {
    const { embedding } = await embed({ model: fastembed, value: 'hello world' });

    expect(Array.isArray(embedding)).toBe(true);
    // bge-small is 384-dim. The index name encodes that, and Mastra derives the index
    // it writes to from the embedder's actual dimension — so if the model is swapped
    // or fails to load and falls back to a different size, writes and reads land in
    // different indexes and semantic search silently returns nothing.
    expect(embedding).toHaveLength(384);
    expect(MESSAGE_VECTOR_INDEX).toBe(`memory_messages_${embedding.length}`);
    expect(embedding.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
  });

  it('places related text nearer than unrelated text', async () => {
    // The property the sidebar actually depends on. A model that loads but returns
    // garbage (or constant) vectors would pass the shape check above and still make
    // search useless, so assert on ranking, not just dimensions.
    const [q, near, far] = await Promise.all(
      [
        'how do I reset my password',
        'steps to change your account password',
        'the migratory patterns of arctic terns',
      ].map((value) => embed({ model: fastembed, value }).then((r) => r.embedding)),
    );

    const cos = (a: number[], b: number[]) => {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    };

    expect(cos(q, near)).toBeGreaterThan(cos(q, far));
  });
});
