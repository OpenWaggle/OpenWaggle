/** `values` in consecutive batches of at most `size` values, in order. */
export function batchesOf<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('A batch holds at least one value.')
  const batches: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    batches.push(values.slice(offset, offset + size))
  }
  return batches
}
