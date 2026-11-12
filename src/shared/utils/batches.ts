/** `values` in consecutive batches of at most `size` values, in order. */
export function batchesOf<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('A batch holds at least one value.')
  const batches: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    batches.push(values.slice(offset, offset + size))
  }
  return batches
}

/**
 * Loads `values` in batches of at most `size`, one batch after another, and returns every result
 * in order. A batch starts only after the previous one settled: the Session Host answers these
 * reads on one SQLite connection, so batches sent together only wait in its queue and hold the
 * first results back. `stopped` is asked after each batch; once it answers true no further batch
 * is requested and the results so far are returned.
 */
export async function loadInBatches<T, R>(
  values: readonly T[],
  size: number,
  load: (batch: T[]) => Promise<readonly R[]>,
  stopped: () => boolean = () => false,
): Promise<R[]> {
  const results: R[] = []
  for (const batch of batchesOf(values, size)) {
    results.push(...(await load(batch)))
    if (stopped()) break
  }
  return results
}
