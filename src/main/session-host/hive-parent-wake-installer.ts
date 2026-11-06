import * as SqlClient from '@effect/sql/SqlClient'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { type HiveParentWakeOutcome, wakeIdleParent } from '../application/hive-parent-wake'
import {
  type HiveParentWakeRequest,
  installHiveParentWakeHandler,
} from '../application/hive-parent-wake-request'
import { createLogger } from '../logger'
import { resolveHiveWakeAuthority } from './hive-parent-wake-authority'
import { createHiveParentWakeScheduler } from './hive-parent-wake-scheduler'
import { workerChangeMayWakeParent } from './hive-wake-trigger-authority'

const logger = createLogger('hive-parent-wake')

type HiveParentWakeDependencies =
  | Effect.Effect.Context<ReturnType<typeof wakeIdleParent<never>>>
  | SqlClient.SqlClient

/**
 * Installs the Session Host's Hive wake handler (`hive-parent-wake.ts`). Each wake runs in the
 * background, so Run settlement and Delegation commands never wait on it, and one parent's wakes
 * run one at a time (`hive-parent-wake-scheduler.ts`).
 */
export const installHiveParentWake = Effect.gen(function* () {
  const context = yield* Effect.context<HiveParentWakeDependencies>()
  const scheduler = createHiveParentWakeScheduler({
    start: (request, done) => {
      const { parentSessionId } = request
      let outcome: HiveParentWakeOutcome | undefined
      Effect.runFork(
        wakeIdleParent(request, (candidate) =>
          SqlClient.SqlClient.pipe(
            Effect.flatMap((sql) => resolveHiveWakeAuthority(sql, candidate)),
            Effect.tap((authority) =>
              Effect.sync(() => {
                if (authority.blocked === undefined) return
                logger.info(
                  'A Hive wake was refused: its caller may no longer message the parent',
                  {
                    parentSessionId,
                    reason: authority.blocked,
                  },
                )
              }),
            ),
          ),
        ).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              outcome = result
              if (result === 'refused') logger.info('A Hive wake was refused', { parentSessionId })
            }),
          ),
          Effect.provide(context),
          Effect.catchAllCause((cause) =>
            Effect.sync(() => {
              if (Cause.isInterruptedOnly(cause)) return
              logger.warn('A Hive wake failed', { parentSessionId, cause: Cause.pretty(cause) })
            }),
          ),
          Effect.ensuring(Effect.sync(() => done(outcome))),
        ),
      )
    },
    onDeferredFull: (parentSessionId) =>
      logger.warn('A Hive wake was dropped: too many parents wait for a free Run', {
        parentSessionId,
      }),
  })
  // A Worker change someone caused wakes the parent only if they may (`hive-wake-trigger-
  // authority.ts`); the Host's own requests (a Run settled) need no such check.
  const request = (wake: HiveParentWakeRequest) => {
    const { parentSessionId, triggerCallerId } = wake
    if (triggerCallerId === undefined) {
      scheduler.request({ parentSessionId })
      return
    }
    Effect.runFork(
      SqlClient.SqlClient.pipe(
        Effect.flatMap((sql) =>
          workerChangeMayWakeParent(sql, { parentSessionId, triggerCallerId }),
        ),
        Effect.tap((mayWake) =>
          Effect.sync(() => {
            if (mayWake) {
              scheduler.request({ parentSessionId })
              return
            }
            logger.info('A Worker update waits for the parent: its cause may not wake it', {
              parentSessionId,
            })
          }),
        ),
        Effect.provide(context),
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            if (Cause.isInterruptedOnly(cause)) return
            logger.warn('A Hive wake check failed', { parentSessionId, cause: Cause.pretty(cause) })
          }),
        ),
      ),
    )
  }
  const release = installHiveParentWakeHandler(request)
  yield* Effect.addFinalizer(() => Effect.sync(release))
})
