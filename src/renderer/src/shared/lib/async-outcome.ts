/**
 * `try { return await operation() } finally { await after() }`, for components and hooks.
 *
 * React Compiler 1.0 cannot lower a `try` statement that has a `finally` clause or no `catch`
 * clause. A component or hook containing one, even inside a nested event handler, is emitted
 * uncompiled, so it loses its memoization on every render. Keep the `finally` here instead.
 */
export async function withFinally<T>(
  operation: () => Promise<T> | T,
  after: () => unknown,
): Promise<T> {
  try {
    return await operation()
  } finally {
    await after()
  }
}

export type AsyncOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown }

/**
 * Settles `operation` into a result instead of throwing, for components and hooks.
 *
 * React Compiler 1.0 cannot lower conditionals, logical or optional-chaining expressions inside a
 * `try` block, and bails out of the whole component or hook. Branch on the outcome instead.
 */
export async function attempt<T>(operation: () => Promise<T> | T): Promise<AsyncOutcome<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { ok: false, error }
  }
}
