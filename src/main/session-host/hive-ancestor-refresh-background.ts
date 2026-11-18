import * as Effect from 'effect/Effect'
import { refreshHiveAncestors } from '../application/hive-ancestor-refresh'
import { createLogger } from '../logger'
import { publishSessionHostEvent, tryGetSessionHostEventRuntime } from './session-host-events'

const logger = createLogger('hive-ancestor-refresh')

/**
 * Keeps every parent's Running Workers current in the windows (ADR 0065): reads the Host's own
 * events and, when a Run may have started or settled, republishes each ancestor's catalog entry.
 */
export const runHiveAncestorRefreshBackground = Effect.gen(function* () {
  const eventRuntime = tryGetSessionHostEventRuntime()
  if (!eventRuntime) return
  const subscribe = () => {
    const result = eventRuntime.eventHub.subscribeAfter()
    if (result.status !== 'ready') throw new Error('The Hive ancestor refresh could not subscribe.')
    return result.subscription
  }
  let subscription = subscribe()
  yield* Effect.addFinalizer(() => Effect.sync(() => subscription.close()))
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        const delivery = yield* Effect.promise(() => subscription.next())
        if (delivery.status === 'closed') return
        if (delivery.status === 'resync-required') {
          // A parent missed here stays stale until its next Worker Run starts or settles.
          logger.warn('The Hive ancestor refresh missed Host events', { reason: delivery.reason })
          subscription.close()
          subscription = subscribe()
          continue
        }
        if (delivery.status !== 'event') continue
        yield* refreshHiveAncestors(delivery.event.payload, publishSessionHostEvent).pipe(
          Effect.catchAllCause((cause) =>
            Effect.sync(() =>
              logger.warn('Could not refresh the Hive ancestors of a Session', {
                cause: String(cause),
              }),
            ),
          ),
        )
      }
    }),
  )
})
