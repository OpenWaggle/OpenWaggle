import { RunId, type SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'
import {
  claimSessionWriterSuccessorAndWait,
  releaseClaimedSessionWriterSuccessor,
  reserveActiveSessionRun,
} from './active-session-runs'
import { coordinateSessionRuns } from './session-control-run-coordinator'
import { settleExternalSessionRun } from './session-external-run-coordinator'
import type { SessionHostRunLease } from './session-host-run-admission'
import { forkSupervisedSessionRuns } from './session-run-coordinator-supervision'

export function awaitExistingSessionWriter(sessionId: SessionId, signal?: AbortSignal) {
  return Effect.tryPromise({
    try: () => claimSessionWriterSuccessorAndWait(sessionId, 'waggle', signal),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

export function settlePreparedWaggleFailure(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly terminalStatus: 'failed' | 'interrupted'
  readonly lease: SessionHostRunLease
  readonly successorToken?: symbol
}) {
  let leaseTransferred = false
  let successorConsumed = false
  return Effect.gen(function* () {
    const settlement = yield* settleExternalSessionRun({
      sessionId: input.sessionId,
      runId: input.runId,
      terminalStatus: input.terminalStatus,
    })
    if (!settlement.accepted || !settlement.scheduled) return
    const successorToken =
      input.successorToken ?? (yield* awaitExistingSessionWriter(input.sessionId)) ?? undefined
    const nextRunId = RunId(settlement.scheduled.runId)
    const reservation = yield* Effect.sync(() => {
      successorConsumed = successorToken !== undefined
      return reserveActiveSessionRun(input.sessionId, nextRunId, successorToken)
    })
    yield* forkSupervisedSessionRuns({
      sessionId: input.sessionId,
      runId: nextRunId,
      effect: coordinateSessionRuns({
        sessionId: input.sessionId,
        startingRunId: nextRunId,
        initialReservation: reservation,
        lease: input.lease,
      }),
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(reservation.release).pipe(Effect.zipRight(Effect.failCause(cause))),
      ),
    )
    leaseTransferred = true
  }).pipe(
    Effect.onError(() => Effect.sync(requestHostDrain)),
    Effect.ensuring(
      Effect.sync(() => {
        if (input.successorToken && !successorConsumed) {
          releaseClaimedSessionWriterSuccessor(input.sessionId, input.successorToken)
        }
        if (!leaseTransferred) input.lease.release()
      }),
    ),
  )
}

function requestHostDrain() {
  tryGetSessionHostEventRuntime()?.liveness.requestDrain()
}
