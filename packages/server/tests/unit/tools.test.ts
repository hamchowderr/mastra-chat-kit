import { describe, expect, it } from 'vitest';
import { getWeather } from '../../src/mastra/agents/chat';
import { callTool } from '../helpers/call-tool';

type Weather = { location: string; temperatureC: number; condition: string };

// Pure, deterministic tool logic — no LLM, no AIMock needed.
describe('chat tools', () => {
  it('getWeather returns deterministic structured output', async () => {
    const a = await callTool<Weather>(getWeather, { location: 'Los Angeles' });
    const b = await callTool<Weather>(getWeather, { location: 'Los Angeles' });
    expect(a).toEqual(b); // deterministic
    expect(a.location).toBe('Los Angeles');
    expect(typeof a.temperatureC).toBe('number');
    expect(typeof a.condition).toBe('string');
  });
});
