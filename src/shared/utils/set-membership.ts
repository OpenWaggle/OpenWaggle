/**
 * Membership filters between two lists. Each one builds a Set of the list it looks values up
 * in, so filtering stays linear in both lengths instead of scanning one list per value.
 */

/** The values of `values` that `allowed` contains, in `values` order. */
export function valuesIn<T>(values: readonly T[], allowed: Iterable<T>) {
  const lookup = new Set(allowed)
  return values.filter((value) => lookup.has(value))
}

/** The values of `values` that `excluded` does not contain, in `values` order. */
export function valuesNotIn<T>(values: readonly T[], excluded: Iterable<T>) {
  const lookup = new Set(excluded)
  return values.filter((value) => !lookup.has(value))
}

/** Whether `available` contains every value of `required`. */
export function includesEvery<T>(available: Iterable<T>, required: readonly T[]) {
  const lookup = new Set(available)
  return required.every((value) => lookup.has(value))
}
