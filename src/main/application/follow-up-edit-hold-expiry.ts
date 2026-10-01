import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { createLogger } from '../logger'
import {
  type ExpiredFollowUpEditHold,
  FollowUpEditHoldRepository,
} from '../ports/follow-up-edit-hold-repository'
import { dispatchAdmittedSessionControlCommand } from './local-session-command-dispatcher'

const logger = createLogger('follow-up-edit-hold-expiry')

/** How often the Host looks for Follow-up edit holds whose lease ran out. */
export const FOLLOW_UP_EDIT_HOLD_SWEEP_INTERVAL_MS = 5_000

/**
 * An expired hold is already gone from every delivery decision; releasing it here only gives an
 * idle Session whose queue it blocked the chance to deliver, through the same cancel the holder
 * would have sent. The cancel is journaled under the holder with a key derived from the hold, so a
 * retried sweep replays instead of acting twice.
 */
function releaseExpiredHold(hold: ExpiredFollowUpEditHold) {
  const key = `follow-up-edit-hold-expired:${hold.holdId}`
  return dispatchAdmittedSessionControlCommand({
    caller: { callerId: hold.holderCallerId },
    payload: {
      contract: 'session-control-v2',
      request: {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: key,
        idempotencyKey: key,
        command: {
          operation: 'queue-edit-cancel',
          sessionId: hold.sessionId,
          followUpId: hold.followUpId,
          holdId: hold.holdId,
        },
      },
    },
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (Cause.isInterruptedOnly(cause)) return
        logger.warn('An expired Follow-up edit hold could not resume its queue', {
          sessionId: hold.sessionId,
          cause: Cause.pretty(cause),
        })
      }),
    ),
  )
}

export const releaseExpiredFollowUpEditHolds = Effect.gen(function* () {
  const holds = yield* FollowUpEditHoldRepository
  const expired = yield* holds.takeExpired()
  yield* Effect.forEach(expired, releaseExpiredHold, { discard: true })
  return expired.length
})

export const runFollowUpEditHoldExpiryBackground = Effect.forkScoped(
  releaseExpiredFollowUpEditHolds.pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (Cause.isInterruptedOnly(cause)) return
        logger.warn('Follow-up edit hold sweep failed', { cause: Cause.pretty(cause) })
      }),
    ),
    Effect.repeat(Schedule.spaced(FOLLOW_UP_EDIT_HOLD_SWEEP_INTERVAL_MS)),
  ),
)
