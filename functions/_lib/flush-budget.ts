/**
 * The KV operation budget of one flush call. Workers allow 1000 KV operations per invocation;
 * every call the flush makes, reads, writes, deletes and lists alike, goes through
 * {@link budgetedStore} and counts against one budget below that limit. Optional work, such as
 * listing, reading and cleanup, runs only while it leaves the reserve free, so the end of a
 * flush, which records, publishes and retires what it read, always has the operations it needs.
 */
import type { KeyValueStore } from './cloudflare'
import { EndpointError } from './exception-report'

export const FLUSH_KV_OPERATIONS = 950
/** Entries one flush sends at most: a full flush and the remainder that must go with it. */
export const MAX_SELECTED_ENTRIES = 55
/** Entries already published or unreadable that one call deletes at most. */
export const CLEANUP_MAX_KEYS = 20
/**
 * Operations kept for the end of a flush: re-reading the lease, writing and deleting the
 * manifest, and retiring every sent entry, a delete and, when it fails, a tombstone.
 */
export const PUBLISH_RESERVE = 3 + 2 * MAX_SELECTED_ENTRIES
/** Workers allow six simultaneous connections; KV calls count toward them. */
const KV_CONCURRENCY = 6

export class OperationBudget {
  private used = 0

  constructor(
    private readonly limit: number,
    private readonly reserve: number,
  ) {}

  /** Operations made so far. */
  get spent() {
    return this.used
  }

  /** Whether `count` optional operations still leave the reserve free. */
  allows(count: number) {
    return this.used + count <= this.limit - this.reserve
  }

  /** Whether `count` operations fit at all, for a call that will publish nothing. */
  fits(count: number) {
    return this.used + count <= this.limit
  }

  /** Counts operations; going past the limit is a bug, never a request to cut corners. */
  spend(count: number) {
    this.used += count
    if (this.used > this.limit) {
      throw new EndpointError('the flush exceeded its KV operation budget')
    }
  }
}

/** `store`, with every operation counted against `budget`. */
export function budgetedStore(store: KeyValueStore, budget: OperationBudget): KeyValueStore {
  return {
    get: (key) => {
      budget.spend(1)
      return store.get(key)
    },
    put: (key, value, options) => {
      budget.spend(1)
      return store.put(key, value, options)
    },
    delete: (key) => {
      budget.spend(1)
      return store.delete(key)
    },
    list: (options) => {
      budget.spend(1)
      return store.list(options)
    },
  }
}

/** Runs `run` over `items`, at most `KV_CONCURRENCY` at a time. */
export async function inKvBatches<T, R>(items: readonly T[], run: (item: T) => Promise<R>) {
  const results: R[] = []
  for (let start = 0; start < items.length; start += KV_CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(start, start + KV_CONCURRENCY).map(run))))
  }
  return results
}

/** Whether `operation` succeeded. KV failures are reported, never thrown, by the flush; a budget
 * overrun is a bug and is thrown. */
export async function attempt(operation: () => Promise<unknown>) {
  try {
    await operation()
    return true
  } catch (error) {
    if (error instanceof EndpointError) throw error
    return false
  }
}
