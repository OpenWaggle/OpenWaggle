/**
 * Typed as a value: the tuple type parameter appears in the signature only through the result, so
 * a function declaration would need a return type to use it twice.
 */
type AllInOrder = <const T extends readonly unknown[]>(
  values: T,
) => Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }>

/**
 * Waits for every value like `Promise.all`, but settles all of them before deciding and then
 * rejects with the first rejection in argument order, not the first one in time. Independent
 * work can overlap while the error a caller sees stays the one it saw when that work ran one
 * step after another.
 */
export const allInOrder: AllInOrder = async (values) => {
  const settled = await Promise.allSettled(values)
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason
  }
  // Every value has settled, so this resolves at once with the same values, typed per position.
  return Promise.all(values)
}

/**
 * A settled outcome's value, or its rejection rethrown. Reading `Promise.allSettled` outcomes in
 * order with it behaves like awaiting each task in turn, except that every task has started.
 */
export function settledValue<T>(outcome: PromiseSettledResult<T>) {
  if (outcome.status === 'rejected') throw outcome.reason
  return outcome.value
}
