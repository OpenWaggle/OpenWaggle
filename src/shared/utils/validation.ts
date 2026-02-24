/**
 * Shared validation utilities used by both main and renderer processes.
 */

/**
 * Type-safe array inclusion check.
 * Narrows `value` to a member of the tuple's element type.
 *
 * The internal widening cast is safe and contained — callers only see the
 * type predicate return, which narrows `value` from `string` to `T`.
 */
export function includes<T extends string>(arr: readonly T[], value: string): value is T {
  return (arr as readonly string[]).includes(value)
}

/**
 * Validates that a string is a well-formed base URL with http: or https: protocol.
 * Used for provider baseUrl validation in settings (both read and write paths).
 */
export function isValidBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
