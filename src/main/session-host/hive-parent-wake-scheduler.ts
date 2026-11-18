import type { HiveParentWakeOutcome } from '../application/hive-parent-wake'
import type { HiveParentWakeRequest } from '../application/hive-parent-wake-request'

/** Parents a full Run limit held back, retried at the next request; bounded like Hive cleanup. */
export const MAX_DEFERRED_PARENTS = 256

export interface HiveParentWakeScheduler {
  /** Wake this parent if it needs it, and retry every parent a Run limit held back. */
  readonly request: (request: HiveParentWakeRequest) => void
}

/**
 * Runs Hive wakes (`hive-parent-wake.ts`) one parent at a time. A request for a parent whose wake
 * is running runs after it, so a wake never races another for the same parent. A wake a full Run
 * limit deferred is retried whenever any later request arrives, since every Run that settles
 * asks. `start` begins one wake in the background and calls `done` with its outcome, or with
 * `undefined` when it failed.
 */
export function createHiveParentWakeScheduler(input: {
  readonly start: (
    request: HiveParentWakeRequest,
    done: (outcome: HiveParentWakeOutcome | undefined) => void,
  ) => void
  readonly onDeferredFull?: (parentSessionId: string) => void
}) {
  const inFlight = new Set<string>()
  const queued = new Set<string>()
  const deferred = new Set<string>()

  const settle = (parentSessionId: string, outcome: HiveParentWakeOutcome | undefined) => {
    if (outcome !== 'deferred') {
      deferred.delete(parentSessionId)
      return
    }
    if (deferred.has(parentSessionId)) return
    if (deferred.size >= MAX_DEFERRED_PARENTS) {
      input.onDeferredFull?.(parentSessionId)
      return
    }
    deferred.add(parentSessionId)
  }

  const run = (parentSessionId: string) => {
    if (inFlight.has(parentSessionId)) {
      queued.add(parentSessionId)
      return
    }
    inFlight.add(parentSessionId)
    input.start({ parentSessionId }, (outcome) => {
      inFlight.delete(parentSessionId)
      settle(parentSessionId, outcome)
      if (!queued.delete(parentSessionId)) return
      run(parentSessionId)
    })
  }

  return {
    request: (request) => {
      run(request.parentSessionId)
      for (const parentSessionId of [...deferred]) {
        if (parentSessionId !== request.parentSessionId) run(parentSessionId)
      }
    },
  } satisfies HiveParentWakeScheduler
}
