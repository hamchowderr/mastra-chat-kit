import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createServerAuth } from '../../src/mastra/lib/auth';
import { createMcpServer } from '../../src/mastra/lib/mcp';

describe('MCP server', () => {
  it('exposes the chat agent as ask_chat, plus the Dolt tools', async () => {
    const { tools } = await createMcpServer().getToolListInfo();
    const names = tools.map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining(['ask_chat', 'doltQuery', 'doltWrite', 'doltHistory']),
    );
  });
});

/** An HS256 JWT signed with `secret`, built by hand so the test needs no JWT library. */
function signHs256(payload: Record<string, unknown>, secret: string): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

describe('server auth (MASTRA_JWT_SECRET)', () => {
  const secret = 'test-jwt-secret-at-least-32-characters-long';

  it('is off when no secret is set', () => {
    expect(createServerAuth(undefined)).toBeUndefined();
  });

  it('accepts a token signed with the secret', async () => {
    const auth = createServerAuth(secret);
    const user = await auth?.authenticateToken(signHs256({ sub: 'sam' }, secret));

    expect(user).toMatchObject({ sub: 'sam' });
  });

  it('rejects a token signed with a different secret', async () => {
    const auth = createServerAuth(secret);
    const forged = signHs256({ sub: 'mallory' }, 'some-other-secret-also-32-characters');

    await expect(auth?.authenticateToken(forged)).rejects.toThrow();
  });
});
