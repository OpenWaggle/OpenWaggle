import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { type HiveParentWakeOutcome, wakeIdleParent } from '../application/hive-parent-wake'
import {
  type HiveParentWakeRequest,
  installHiveParentWakeHandler,
} from '../application/hive-parent-wake-request'
import { createLogger } from '../logger'

const logger = createLogger('hive-parent-wake')

/** Parents a full Run limit held back, retried at the next request; bounded like Hive cleanup. */
const MAX_DEFERRED_PARENTS = 256

type HiveParentWakeDependencies = Effect.Effect.Context<ReturnType<typeof wakeIdleParent>>

/**
 * Installs the Session Host's Hive wake handler (`hive-parent-wake.ts`). Each request runs in the
 * background, so Run settlement and Delegation commands never wait on it. One wake per parent runs
 * at a time; a request that arrives meanwhile runs after it. A wake a Run limit refused is retried
 * whenever any later request arrives, since every Run that settles asks.
 */
export const installHiveParentWake = Effect.gen(function* () {
  const context = yield* Effect.context<HiveParentWakeDependencies>()
  const inFlight = new Set<string>()
  const queued = new Map<string, HiveParentWakeRequest>()
  const deferred = new Set<string>()

  const settle = (parentSessionId: string, outcome: HiveParentWakeOutcome) => {
    if (outcome !== 'deferred') {
      deferred.delete(parentSessionId)
      if (outcome === 'refused') logger.info('A Hive wake was refused', { parentSessionId })
      return
    }
    if (deferred.size < MAX_DEFERRED_PARENTS) deferred.add(parentSessionId)
  }

  const run = (request: HiveParentWakeRequest) => {
    const { parentSessionId } = request
    if (inFlight.has(parentSessionId)) {
      queued.set(parentSessionId, request)
      return
    }
    inFlight.add(parentSessionId)
    Effect.runFork(
      wakeIdleParent(request).pipe(
        Effect.tap((outcome) => Effect.sync(() => settle(parentSessionId, outcome))),
        Effect.provide(context),
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            if (Cause.isInterruptedOnly(cause)) return
            logger.warn('A Hive wake failed', { parentSessionId, cause: Cause.pretty(cause) })
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            inFlight.delete(parentSessionId)
            const next = queued.get(parentSessionId)
            if (!next) return
            queued.delete(parentSessionId)
            run(next)
          }),
        ),
      ),
    )
  }

  const release = installHiveParentWakeHandler((request) => {
    run(request)
    for (const parentSessionId of [...deferred]) {
      if (parentSessionId !== request.parentSessionId) run({ parentSessionId })
    }
  })
  yield* Effect.addFinalizer(() => Effect.sync(release))
})
