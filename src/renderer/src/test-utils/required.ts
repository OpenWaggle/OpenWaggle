/**
 * Returns `value`, failing the test with `what` in the message when it is missing. Indexed reads
 * are `T | undefined` under noUncheckedIndexedAccess, and a test that reads `items[2]` expects it
 * to be there.
 */
export function required<T>(value: T | null | undefined, what = 'value') {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be present`)
  return value
}
