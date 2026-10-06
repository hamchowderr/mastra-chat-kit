/**
 * The user's time zone on a turn: the request-context key it travels under, and the
 * check that `Intl` knows it. No imports, so the route contract (chat-server) can ship it.
 */

/** The request-context key the user's IANA time zone travels under. */
export const TIME_ZONE_KEY = 'timeZone';

/** True when `Intl` knows the zone (an IANA name such as `Europe/London`, or `UTC`). */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
