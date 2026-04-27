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
  for (const item of arr) {
    if (item === value) {
      return true
    }
  }

  return false
}

/**
 * Type guard for plain objects (non-null, non-array).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
