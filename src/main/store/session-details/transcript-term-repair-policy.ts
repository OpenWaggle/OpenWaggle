/** Sessions repaired per background pass. */
export const REPAIR_BATCH_SIZE = 4

/** Up to `limit` keys in insertion order, without materializing the rest. */
export function firstKeys(map: ReadonlyMap<string, unknown>, limit: number) {
  const keys: string[] = []
  for (const key of map.keys()) {
    if (keys.length >= limit) break
    keys.push(key)
  }
  return keys
}

/**
 * Whether the background loop starts the next pass at once. Only a fully successful batch may
 * have more behind it; anything less waits for a wake or the idle interval, so a systemic failure
 * cannot spin the loop.
 */
export function continuesImmediately(result: { readonly repaired: number }) {
  return result.repaired >= REPAIR_BATCH_SIZE
}
