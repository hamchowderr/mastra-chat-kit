/**
 * The connectors a person turned off for one chat (the composer's + menu): the request-context
 * key they travel under, and the reading of the list the browser sends. No imports, so the
 * route contract (chat-server) can ship it.
 *
 * It can only take tools away. The host decides what a name means (a Composio toolkit, say)
 * and keeps every other check it has; a name it doesn't know turns nothing off.
 */

/** The request-context key the turned-off connector names travel under. */
export const CONNECTORS_OFF_KEY = 'connectorsOff';

/** At most this many names are read; the rest are ignored. */
export const MAX_CONNECTORS_OFF = 200;

/**
 * The names from a turn's body: lower-case slugs, each once. Anything else is dropped rather
 * than refusing the turn, since the list comes from the browser's own storage.
 */
export function readConnectorsOff(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = new Set<string>();
  for (const item of value.slice(0, MAX_CONNECTORS_OFF)) {
    if (typeof item === 'string' && /^[a-z0-9_-]{1,64}$/.test(item)) names.add(item);
  }
  return names.size > 0 ? [...names] : undefined;
}
