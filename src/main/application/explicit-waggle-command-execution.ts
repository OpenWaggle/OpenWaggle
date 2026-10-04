import type { AgentSendPayload, HydratedAgentSendPayload } from '@shared/types/agent'
import { RunId, type SessionId, type SupportedModelId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'
import {
  currentSessionWriterRunId,
  reserveActiveSessionRun,
  reserveWaggleSessionWriter,
} from './active-session-runs'
import { cancelAgentLoopInteractionsForRun } from './agent-loop-interaction-broker'
import {
  describeExplicitWaggleOutcome,
  explicitWaggleTerminalResult,
} from './explicit-waggle-command-result'
import { runRegisteredExplicitWaggle } from './explicit-waggle-command-runner'
import {
  awaitExistingSessionWriter,
  settlePreparedWaggleFailure,
} from './explicit-waggle-command-settlement'
import { coordinateSessionRuns } from './session-control-run-coordinator'
import {
  activatePreparedExternalSessionRun,
  prepareExternalSessionRunReplacement,
  settleExternalSessionRun,
} from './session-external-run-coordinator'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'
import { captureRunResultResources } from './session-resource-run-result'
import { forkSupervisedSessionRuns } from './session-run-coordinator-supervision'
import { runAndCaptureWithRetainedScratch } from './session-scratch-retention'
import {
  recordRunFinishedForUsageStatistics,
  recordRunStartedForUsageStatistics,
} from './usage-statistics-recording'

interface ExplicitWaggleRunContext {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly payload: AgentSendPayload
  readonly hydratedAttachments: HydratedAgentSendPayload['attachments']
  readonly model: SupportedModelId
  readonly config: WaggleConfig
  readonly abortController: AbortController
}

function explicitWaggleIntent(payload: AgentSendPayload, callerId: string, idempotencyKey: string) {
  return {
    text: payload.text,
    attachmentIds: payload.attachments.map((attachment) => attachment.id),
    callerId,
    acceptedAt: Date.now(),
    idempotencyKey,
  } as const
}

export function prepareExplicitWaggleReplacement(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly payload: AgentSendPayload
  readonly callerId: string
  readonly idempotencyKey: string
  readonly hostRunCeiling?: number
}) {
  return Effect.gen(function* () {
    const lease = yield* acquireSessionHostRunLease('run').pipe(
      Effect.tapError(() => Effect.sync(requestHostDrain)),
    )
    const previousRunId = currentSessionWriterRunId(input.sessionId)
    const preparation = yield* prepareExternalSessionRunReplacement({
      sessionId: input.sessionId,
      ...(previousRunId ? { previousRunId: RunId(previousRunId) } : {}),
      runId: input.runId,
      intent: explicitWaggleIntent(input.payload, input.callerId, input.idempotencyKey),
      ...(input.hostRunCeiling ? { hostRunCeiling: input.hostRunCeiling } : {}),
    }).pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          lease.release()
          requestHostDrain()
        }),
      ),
    )
    if (!preparation.accepted) {
      lease.release()
      return yield* Effect.fail(
        new Error(`Could not prepare explicit Waggle replacement: ${preparation.code}.`),
      )
    }
    return { lease }
  })
}

export function reservePreparedExplicitWaggleWriter(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly abortController: AbortController
  readonly lease: SessionHostRunLease
}) {
  return Effect.gen(function* () {
    const successorToken = yield* awaitExistingSessionWriter(
      input.sessionId,
      input.abortController.signal,
    ).pipe(
      Effect.tapError(() =>
        settlePreparedWaggleFailure({
          sessionId: input.sessionId,
          runId: input.runId,
          terminalStatus: input.abortController.signal.aborted ? 'interrupted' : 'failed',
          lease: input.lease,
        }),
      ),
    )
    if (input.abortController.signal.aborted) {
      return yield* settlePreparedWaggleFailure({
        sessionId: input.sessionId,
        runId: input.runId,
        terminalStatus: 'interrupted',
        lease: input.lease,
        ...(successorToken ? { successorToken } : {}),
      }).pipe(Effect.zipRight(Effect.fail(pendingWaggleCancellationError())))
    }
    const writer = yield* Effect.try(() =>
      reserveWaggleSessionWriter(
        input.sessionId,
        input.abortController,
        input.runId,
        successorToken ?? undefined,
      ),
    ).pipe(
      Effect.tapError(() =>
        settlePreparedWaggleFailure({
          sessionId: input.sessionId,
          runId: input.runId,
          terminalStatus: input.abortController.signal.aborted ? 'interrupted' : 'failed',
          lease: input.lease,
          ...(successorToken ? { successorToken } : {}),
        }),
      ),
    )
    return { lease: input.lease, writer }
  })
}

export function executePreparedExplicitWaggle(
  input: ExplicitWaggleRunContext & {
    readonly lease: SessionHostRunLease
    readonly writer: ReturnType<typeof reserveWaggleSessionWriter>
  },
) {
  let writerReleased = false
  let leaseTransferred = false
  return Effect.gen(function* () {
    const activation = yield* activatePreparedExternalSessionRun(input)
    if (!activation.accepted) {
      return yield* Effect.fail(
        new Error(`Could not activate explicit Waggle: ${activation.code}.`),
      )
    }
    yield* recordRunStartedForUsageStatistics({
      sessionId: input.sessionId,
      runId: input.runId,
      intent: activation.intent,
      waggle: true,
    })
    // Capture the Waggle's resources, such as images its agents embedded, as a classic Run does.
    // The scratch directory is held through the capture for images the agents wrote there.
    const result = yield* runAndCaptureWithRetainedScratch({
      sessionId: input.sessionId,
      run: runRegisteredExplicitWaggle(input),
      capture: (waggleResult) =>
        captureRunResultResources(input.sessionId, input.runId, input.payload, waggleResult),
    })
    const terminal = explicitWaggleTerminalResult(result)
    yield* recordRunFinishedForUsageStatistics({
      runId: input.runId,
      intent: activation.intent,
      terminalStatus: terminal.terminalStatus,
      waggle: true,
    })
    const settlement = yield* settleExternalSessionRun({
      sessionId: input.sessionId,
      runId: input.runId,
      ...terminal,
    })
    if (settlement.accepted && settlement.scheduled) {
      const nextRunId = RunId(settlement.scheduled.runId)
      const reservation = yield* Effect.sync(() => {
        input.writer.release()
        writerReleased = true
        return reserveActiveSessionRun(input.sessionId, nextRunId)
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
    }
    return describeExplicitWaggleOutcome(result)
  }).pipe(
    Effect.onError(() => Effect.sync(requestHostDrain)),
    Effect.ensuring(
      Effect.sync(() => {
        cancelAgentLoopInteractionsForRun({ sessionId: input.sessionId, runId: input.runId })
        if (!writerReleased) input.writer.release()
        if (!leaseTransferred) input.lease.release()
      }),
    ),
  )
}

function pendingWaggleCancellationError() {
  return new Error('Pending explicit Waggle run was cancelled.')
}

function requestHostDrain() {
  tryGetSessionHostEventRuntime()?.liveness.requestDrain()
}
