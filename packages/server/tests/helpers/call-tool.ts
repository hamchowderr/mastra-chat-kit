/**
 * Invoke a Mastra tool's `execute` directly from a test.
 *
 * A bare `tool.execute(input)` runs correctly but does not typecheck, for two
 * reasons that are both artifacts of the tool type rather than of the test:
 * `execute` is declared optional, and its second parameter is a full
 * `AgentToolExecutionContext` (`toolCallId`, `messages`, `suspend`, …) that a
 * hermetic test has no way to build. The tools exercised here read only the few
 * context fields they actually use, so tests hand in a minimal fabricated one —
 * exactly as the live controller would supply the real thing.
 *
 * Centralising both narrowings here keeps the assertions readable and stops the
 * casts from spreading across every call site.
 */
export async function callTool<TOutput>(
  tool: { id?: string; execute?: unknown },
  input: unknown,
  context: unknown = {},
): Promise<TOutput> {
  if (typeof tool.execute !== 'function') {
    throw new Error(`tool ${tool.id ?? '<unknown>'} has no execute() to call`);
  }
  return (tool.execute as (i: unknown, c: unknown) => Promise<TOutput>)(input, context);
}
