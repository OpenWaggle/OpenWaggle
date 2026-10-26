import type { SessionId } from '@shared/types/brand'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { createLogger } from '../logger'
import { HiveWorkerCleanup } from '../ports/hive-worker-cleanup'
import { DEFAULT_KEPT_RETRY_DELAYS_MS, makeKeptWorkerRetries } from './hive-worker-cleanup-retries'
import {
  reconcileHiveWorkerCleanupPass,
  restoreHiveWorkerForCommand,
} from './hive-worker-cleanup-service'

const logger = createLogger('hive-worker-cleanup')

type HiveWorkerCleanupDependencies =
  | Effect.Effect.Context<ReturnType<typeof reconcileHiveWorkerCleanupPass>>
  | Effect.Effect.Context<ReturnType<typeof restoreHiveWorkerForCommand>>

/**
 * `background` (the Host default) forks each pass so Run settlement and Delegation review never
 * wait on archive teardown, and re-checks Workers that live desktop state kept. `inline` completes
 * the pass before returning, for deterministic tests. Restoration for a resuming command always
 * runs inline: it is part of that command.
 */
export function makeHiveWorkerCleanupLayer(
  strategy: 'background' | 'inline' = 'background',
  options: { readonly retryDelaysMs?: readonly number[] } = {},
) {
  return Layer.effect(
    HiveWorkerCleanup,
    Effect.gen(function* () {
      const context = yield* Effect.context<HiveWorkerCleanupDependencies>()
      const retries =
        strategy === 'background'
          ? makeKeptWorkerRetries(options.retryDelaysMs ?? DEFAULT_KEPT_RETRY_DELAYS_MS, (id) =>
              requestReconciliation(id),
            )
          : undefined
      function requestReconciliation(sessionId: SessionId): Effect.Effect<void> {
        const pass = reconcileHiveWorkerCleanupPass(sessionId).pipe(
          Effect.tap((result) => (retries ? retries.afterPass(sessionId, result) : Effect.void)),
          Effect.tapErrorCause(() => (retries ? retries.forget(sessionId) : Effect.void)),
          Effect.provide(context),
          Effect.catchAllCause((cause) =>
            Effect.sync(() => {
              logger.warn('Hive cleanup pass failed', {
                sessionId,
                cause: Cause.pretty(cause),
              })
            }),
          ),
          Effect.asVoid,
        )
        return strategy === 'inline' ? pass : pass.pipe(Effect.forkDaemon, Effect.asVoid)
      }
      return HiveWorkerCleanup.of({
        requestReconciliation,
        restoreForCommand: (input) =>
          restoreHiveWorkerForCommand(input).pipe(
            Effect.provide(context),
            Effect.catchAllCause((cause) =>
              Effect.sync(() => {
                logger.warn(
                  'Could not restore a Hive cleanup-archived Worker for a resuming command',
                  {
                    sessionId: input.sessionId,
                    cause: Cause.pretty(cause),
                  },
                )
              }),
            ),
            Effect.asVoid,
          ),
      })
    }),
  )
}

export const HiveWorkerCleanupLive = makeHiveWorkerCleanupLayer()
