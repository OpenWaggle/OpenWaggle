/**
 * Returns `value`, failing the test with `what` in the message when it is missing. Indexed reads
 * are `T | undefined` under noUncheckedIndexedAccess, and a test that reads `mock.calls[0]`
 * expects the call to have happened.
 */
export function required<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be present`)
  return value
}
