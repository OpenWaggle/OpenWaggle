import { randomUUID } from 'node:crypto'
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import { toWaggleConfig, waggleConfigSchema } from '@shared/schemas/waggle'
import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import {
  type LocalSessionCommandPayload,
  SESSION_WAGGLE_CONTRACT_VERSION,
} from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'
import {
  activeWaggleRuns,
  currentSessionWriterRunId,
  pendingWaggleRuns,
  reserveActiveSessionRun,
  reservePendingWaggleSessionRun,
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
import { preserveOutcomeAfterAttachmentCleanup } from './session-attachment-cleanup'
import { coordinateSessionRuns } from './session-control-run-coordinator'
import {
  activatePreparedExternalSessionRun,
  prepareExternalSessionRunReplacement,
  settleExternalSessionRun,
} from './session-external-run-coordinator'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'
import { forkSupervisedSessionRuns } from './session-run-coordinator-supervision'

type SessionWagglePayload = Extract<LocalSessionCommandPayload, { contract: 'session-waggle-v1' }>

interface ExplicitWaggleRunContext {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly payload: ReturnType<typeof toAgentSendPayload>
  readonly model: SupportedModelId
  readonly config: ReturnType<typeof toWaggleConfig>
  readonly abortController: AbortController
}

function waggleRunId() {
  return `waggle-${randomUUID()}`
}

function explicitWaggleIntent(
  payload: ReturnType<typeof toAgentSendPayload>,
  callerId: string,
  idempotencyKey: string,
) {
  return {
    text: payload.text,
    attachmentIds: payload.attachments.map((attachment) => attachment.id),
    thinkingLevel: payload.thinkingLevel,
    callerId,
    acceptedAt: Date.now(),
    idempotencyKey,
  } as const
}

export function authorizeExplicitWaggleCaller(caller: LocalSessionCallerIdentity) {
  return caller.callerId === 'gui:local-user' && caller.profileAuthority === undefined
    ? Effect.void
    : Effect.fail(new Error('Explicit Waggle commands require the authenticated local GUI caller.'))
}

export function executeExplicitWaggleCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: SessionWagglePayload
}) {
  return authorizeExplicitWaggleCaller(input.caller).pipe(
    Effect.zipRight(runExplicitWaggleCommand(input)),
  )
}

function runExplicitWaggleCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: SessionWagglePayload
}) {
  const sessionId = SessionId(input.payload.request.sessionId)
  const abortController = new AbortController()
  const runId = RunId(waggleRunId())
  const effect = Effect.gen(function* () {
    const request = input.payload.request
    const payload = toAgentSendPayload(
      decodeUnknownOrThrow(agentSendPayloadSchema, request.payload),
    )
    const config = toWaggleConfig(decodeUnknownOrThrow(waggleConfigSchema, request.config))
    const model = SupportedModelId(request.model)
    yield* Effect.try(() => reservePendingWaggleSessionRun(sessionId, abortController, runId))
    const attachmentIds = payload.attachments.map((attachment) => attachment.id)
    yield* SessionControlAttachmentService.pipe(
      Effect.flatMap((service) =>
        service.bind({
          attachmentIds,
          sessionId,
          ownerCallerId: input.caller.callerId,
        }),
      ),
    )
    const prepared = yield* prepareExplicitWaggleWriter({
      sessionId,
      runId,
      payload,
      callerId: input.caller.callerId,
      idempotencyKey: request.idempotencyKey,
      abortController,
    })
    const report = yield* executePreparedExplicitWaggle({
      sessionId,
      runId,
      payload,
      model,
      config,
      abortController,
      ...prepared,
    })

    return {
      contract: 'session-waggle-v1',
      response: {
        contractVersion: SESSION_WAGGLE_CONTRACT_VERSION,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        replayed: false,
        report,
      },
    } as const
  })
  return preserveOutcomeAfterAttachmentCleanup({
    effect,
    cleanup: SessionControlAttachmentService.pipe(
      Effect.flatMap((service) => service.cleanupUnreferenced({ sessionId })),
    ),
    operation: 'run',
    sessionId,
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        pendingWaggleRuns.deleteIfCurrent(sessionId, abortController)
        activeWaggleRuns.deleteIfCurrent(sessionId, abortController)
      }),
    ),
  )
}

function prepareExplicitWaggleWriter(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly payload: ReturnType<typeof toAgentSendPayload>
  readonly callerId: string
  readonly idempotencyKey: string
  readonly abortController: AbortController
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
    const successorToken = yield* awaitExistingSessionWriter(
      input.sessionId,
      input.abortController.signal,
    ).pipe(
      Effect.tapError(() =>
        settlePreparedWaggleFailure({
          sessionId: input.sessionId,
          runId: input.runId,
          terminalStatus: input.abortController.signal.aborted ? 'interrupted' : 'failed',
          lease,
        }),
      ),
    )
    if (input.abortController.signal.aborted) {
      return yield* settlePreparedWaggleFailure({
        sessionId: input.sessionId,
        runId: input.runId,
        terminalStatus: 'interrupted',
        lease,
        ...(successorToken ? { successorToken } : {}),
      }).pipe(Effect.zipRight(Effect.fail(new Error('Pending explicit Waggle run was cancelled.'))))
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
          lease,
          ...(successorToken ? { successorToken } : {}),
        }),
      ),
    )
    return { lease, writer }
  })
}

function executePreparedExplicitWaggle(
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
    const result = yield* runRegisteredExplicitWaggle(input)
    const terminal = explicitWaggleTerminalResult(result)
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

export function cancelLocalExplicitWaggle(sessionId: SessionId) {
  const active = activeWaggleRuns.get(sessionId)
  const pending = pendingWaggleRuns.get(sessionId)
  const cancelledActive = activeWaggleRuns.cancel(sessionId)
  const cancelledPending = pendingWaggleRuns.cancel(sessionId)
  if (cancelledActive && active) {
    cancelAgentLoopInteractionsForRun({
      sessionId,
      runId: active.metadata.runId,
    })
  }
  if (cancelledPending && pending) {
    cancelAgentLoopInteractionsForRun({ sessionId, runId: pending.metadata.runId })
  }
  return cancelledActive || cancelledPending
}

function requestHostDrain() {
  tryGetSessionHostEventRuntime()?.liveness.requestDrain()
}
