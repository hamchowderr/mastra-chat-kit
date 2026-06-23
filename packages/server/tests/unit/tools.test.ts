import { describe, expect, it } from 'vitest';
import { getWeather, searchKnowledge } from '../../src/mastra/agents/chat';

// Pure, deterministic tool logic — no LLM, no AIMock needed.
describe('chat tools', () => {
  it('getWeather returns deterministic structured output', async () => {
    const a = await getWeather.execute({ location: 'Los Angeles' });
    const b = await getWeather.execute({ location: 'Los Angeles' });
    expect(a).toEqual(b); // deterministic
    expect(a.location).toBe('Los Angeles');
    expect(typeof a.temperatureC).toBe('number');
    expect(typeof a.condition).toBe('string');
  });

  it('searchKnowledge returns sourced results', async () => {
    const res = await searchKnowledge.execute({ query: 'mastra memory' });
    expect(res.results.length).toBeGreaterThan(0);
    for (const r of res.results) {
      expect(r.title).toBeTruthy();
      expect(r.url).toMatch(/^https?:\/\//);
      expect(r.snippet).toBeTruthy();
    }
  });
});
