/**
 * The ends of a flush: retiring what it published, and the lease that keeps two flushes from
 * publishing over each other.
 */
import { bufferExpiration, flushedKey } from './buffer-entry'
import type { KeyValueStore } from './cloudflare'
import { EndpointError } from './exception-report'
import { attempt, inKvBatches } from './flush-budget'

export const FLUSH_LEASE_KEY = 'flush-lease:v1'
/** Longer than any flush call runs; KV's minimum expiry is a minute. */
const FLUSH_LEASE_SECONDS = 120
/**
 * KV refuses a second write to one key within a second, with a 429; this leaves a margin. The
 * lease and the manifest are the only keys a flush writes more than once.
 */
export const SAME_KEY_WRITE_INTERVAL_MS = 1100

/**
 * Takes the flush lease with a random nonce, retrying once after the same-key interval when KV
 * refuses the write, as it does when the previous call wrote the lease less than a second ago.
 * The lease is best-effort, as KV is eventually consistent: `/flush` is meant to run only from
 * the usage-stats workflow, whose concurrency group already runs one job at a time, and the
 * lease guards against a manual call overlapping it.
 */
export async function takeFlushLease(
  store: KeyValueStore,
  nonce: string,
  sleep: (milliseconds: number) => Promise<void>,
) {
  const write = () => store.put(FLUSH_LEASE_KEY, nonce, { expirationTtl: FLUSH_LEASE_SECONDS })
  if (await attempt(write)) return true
  await sleep(SAME_KEY_WRITE_INTERVAL_MS)
  return attempt(write)
}

/**
 * Whether this call still holds the lease: `held`, `lost` when a later call took it over, or
 * `unknown` when the lease cannot be read, which must not pass for a takeover.
 */
export async function leaseState(store: KeyValueStore, nonce: string) {
  try {
    return (await store.get(FLUSH_LEASE_KEY)) === nonce ? 'held' : 'lost'
  } catch (error) {
    if (error instanceof EndpointError) throw error
    return 'unknown'
  }
}

export interface RetireResult {
  /** Published entries still in KV, each kept from being sent again by its tombstone. */
  readonly undeleted: number
  /** Published entries neither deleted nor tombstoned, which keep their manifest alive. */
  readonly unretired: number
}

/**
 * Retires published entries: each is deleted, and only when the delete fails is a tombstone
 * written, so the next flush skips the entry instead of sending it again.
 */
export async function retireEntries(
  store: KeyValueStore,
  day: string,
  keys: readonly string[],
): Promise<RetireResult> {
  const expiration = bufferExpiration(day)
  const results = await inKvBatches(keys, async (key) => {
    if (await attempt(() => store.delete(key))) return { deleted: true, retired: true }
    const tombstoned = await attempt(() => store.put(flushedKey(key), '1', { expiration }))
    return { deleted: false, retired: tombstoned }
  })
  return {
    undeleted: results.filter(({ deleted }) => !deleted).length,
    unretired: results.filter(({ retired }) => !retired).length,
  }
}
