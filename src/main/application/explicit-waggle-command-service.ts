import { randomUUID } from 'node:crypto'
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import { toWaggleConfig, waggleConfigSchema } from '@shared/schemas/waggle'
import type { AgentSendReport } from '@shared/types/agent'
import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import {
  type LocalSessionCommandPayload,
  SESSION_WAGGLE_CONTRACT_VERSION,
} from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { SessionControlOperationPendingError } from '../errors'
import { ExplicitWaggleOperationJournal } from '../ports/explicit-waggle-operation-journal'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'
import {
  activeWaggleRuns,
  pendingWaggleRuns,
  reservePendingWaggleSessionRun,
} from './active-session-runs'
import { cancelAgentLoopInteractionsForRun } from './agent-loop-interaction-broker'
import {
  executePreparedExplicitWaggle,
  prepareExplicitWaggleReplacement,
  reservePreparedExplicitWaggleWriter,
} from './explicit-waggle-command-execution'
import {
  registerPreAdmissionWaggleAttempt,
  requestPreAdmissionWaggleInterruptions,
} from './pre-admission-waggle-attempts'
import {
  preserveOutcomeAfterAttachmentCleanup,
  withSessionAttachmentTransition,
} from './session-attachment-cleanup'

type SessionWagglePayload = Extract<LocalSessionCommandPayload, { contract: 'session-waggle-v1' }>

function waggleRunId() {
  return `waggle-${randomUUID()}`
}

function explicitWaggleResponse(
  request: SessionWagglePayload['request'],
  replayed: boolean,
  report: AgentSendReport,
) {
  return {
    contract: 'session-waggle-v1',
    response: {
      contractVersion: SESSION_WAGGLE_CONTRACT_VERSION,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      replayed,
      report,
    },
  } as const
}

function pendingWaggleCancellationError() {
  return new Error('Pending explicit Waggle run was cancelled.')
}

async function waitForPendingWaggleOwner(
  settled: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw pendingWaggleCancellationError()
  await new Promise<void>((resolve, reject) => {
    let finished = false
    const finish = (outcome: 'settled' | 'aborted') => {
      if (finished) return
      finished = true
      signal.removeEventListener('abort', onAbort)
      if (outcome === 'aborted') reject(pendingWaggleCancellationError())
      else resolve()
    }
    const onAbort = () => finish('aborted')
    signal.addEventListener('abort', onAbort, { once: true })
    void settled.then(() => finish('settled'))
    if (signal.aborted) finish('aborted')
  })
}

function reservePendingWaggleWhenAvailable(
  sessionId: SessionId,
  controller: AbortController,
  runId: RunId,
) {
  return Effect.tryPromise({
    try: async () => {
      while (true) {
        if (controller.signal.aborted) throw pendingWaggleCancellationError()
        const current = pendingWaggleRuns.get(sessionId)
        if (!current) return reservePendingWaggleSessionRun(sessionId, controller, runId)
        await waitForPendingWaggleOwner(current.settled, controller.signal)
      }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function executeClaimedExplicitWaggle(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly payload: ReturnType<typeof toAgentSendPayload>
  readonly callerId: string
  readonly idempotencyKey: string
  readonly model: SupportedModelId
  readonly config: ReturnType<typeof toWaggleConfig>
  readonly abortController: AbortController
  readonly releasePreAdmission: () => void
  readonly hostRunCeiling?: number
}) {
  return Effect.gen(function* () {
    yield* reservePendingWaggleWhenAvailable(input.sessionId, input.abortController, input.runId)
    input.releasePreAdmission()
    const transition = yield* withSessionAttachmentTransition({
      sessionId: input.sessionId,
      signal: input.abortController.signal,
      effect: Effect.gen(function* () {
        const attachmentIds = input.payload.attachments.map((attachment) => attachment.id)
        const hydratedAttachments = yield* SessionControlAttachmentService.pipe(
          Effect.flatMap((service) =>
            service.resolve({
              attachmentIds,
              sessionId: input.sessionId,
              ownerCallerId: input.callerId,
            }),
          ),
        )
        if (input.abortController.signal.aborted) {
          return yield* Effect.fail(pendingWaggleCancellationError())
        }
        const prepared = yield* prepareExplicitWaggleReplacement({
          sessionId: input.sessionId,
          runId: input.runId,
          payload: input.payload,
          callerId: input.callerId,
          idempotencyKey: input.idempotencyKey,
          ...(input.hostRunCeiling ? { hostRunCeiling: input.hostRunCeiling } : {}),
        })
        return { hydratedAttachments, ...prepared }
      }),
    })
    const prepared = yield* reservePreparedExplicitWaggleWriter({
      sessionId: input.sessionId,
      runId: input.runId,
      abortController: input.abortController,
      lease: transition.lease,
    })
    return yield* executePreparedExplicitWaggle({
      sessionId: input.sessionId,
      runId: input.runId,
      payload: input.payload,
      hydratedAttachments: transition.hydratedAttachments,
      model: input.model,
      config: input.config,
      abortController: input.abortController,
      ...prepared,
    })
  })
}

export function authorizeExplicitWaggleCaller(caller: LocalSessionCallerIdentity) {
  return caller.callerId === 'gui:local-user' && caller.profileAuthority === undefined
    ? Effect.void
    : Effect.fail(new Error('Explicit Waggle commands require the authenticated local GUI caller.'))
}

export function executeExplicitWaggleCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: SessionWagglePayload
  readonly hostRunCeiling?: number
}) {
  return authorizeExplicitWaggleCaller(input.caller).pipe(
    Effect.zipRight(runExplicitWaggleCommand(input)),
  )
}

function runExplicitWaggleCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: SessionWagglePayload
  readonly hostRunCeiling?: number
}) {
  const request = input.payload.request
  const sessionId = SessionId(input.payload.request.sessionId)
  return Effect.gen(function* () {
    const payload = toAgentSendPayload(
      decodeUnknownOrThrow(agentSendPayloadSchema, request.payload),
    )
    const config = toWaggleConfig(decodeUnknownOrThrow(waggleConfigSchema, request.config))
    const model = SupportedModelId(request.model)
    const abortController = new AbortController()
    const runId = RunId(waggleRunId())
    const releasePreAdmission = registerPreAdmissionWaggleAttempt(sessionId, abortController)
    let preAdmissionReleased = false
    return yield* Effect.gen(function* () {
      const journal = yield* ExplicitWaggleOperationJournal
      const operation = { callerId: input.caller.callerId, request }
      const claim = yield* journal.claim(operation)
      if (claim.status === 'completed') {
        return explicitWaggleResponse(request, claim.replayed, claim.report)
      }
      if (claim.status === 'pending') {
        return yield* Effect.fail(
          new SessionControlOperationPendingError({
            operation: 'waggle',
            sessionId,
            idempotencyKey: request.idempotencyKey,
          }),
        )
      }

      const effect = executeClaimedExplicitWaggle({
        sessionId,
        runId,
        payload,
        callerId: input.caller.callerId,
        idempotencyKey: request.idempotencyKey,
        model,
        config,
        abortController,
        releasePreAdmission: () => {
          releasePreAdmission()
          preAdmissionReleased = true
        },
        ...(input.hostRunCeiling ? { hostRunCeiling: input.hostRunCeiling } : {}),
      })
      const report = yield* preserveOutcomeAfterAttachmentCleanup({
        effect,
        cleanup: withSessionAttachmentTransition({
          sessionId,
          effect: SessionControlAttachmentService.pipe(
            Effect.flatMap((service) => service.cleanupUnreferenced({ sessionId })),
          ),
        }),
        operation: 'run',
        sessionId,
      }).pipe(
        Effect.onError(() =>
          journal
            .complete({
              ...operation,
              report: abortController.signal.aborted
                ? { outcome: 'cancelled' }
                : {
                    outcome: 'cancelled',
                    message: 'The explicit Waggle outcome could not be confirmed.',
                    code: 'waggle_outcome_unresolved',
                  },
            })
            .pipe(Effect.catchAllCause(() => Effect.sync(requestHostDrain))),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            pendingWaggleRuns.deleteIfCurrent(sessionId, abortController)
            activeWaggleRuns.deleteIfCurrent(sessionId, abortController)
          }),
        ),
      )
      yield* journal
        .complete({ ...operation, report })
        .pipe(Effect.tapError(() => Effect.sync(requestHostDrain)))
      return explicitWaggleResponse(request, false, report)
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!preAdmissionReleased) releasePreAdmission()
        }),
      ),
    )
  })
}

export function cancelLocalExplicitWaggle(sessionId: SessionId) {
  const active = activeWaggleRuns.get(sessionId)
  const pending = pendingWaggleRuns.get(sessionId)
  const cancelledPreAdmission = requestPreAdmissionWaggleInterruptions(sessionId)
  // Cancellation is a request, not ownership release. The command finalizer removes these entries
  // only after persistent replacement settlement and attachment cleanup have completed.
  const cancelledActive = activeWaggleRuns.requestInterrupt(sessionId, () => true)
  const cancelledPending = pendingWaggleRuns.requestInterrupt(sessionId, () => true)
  if (cancelledActive && active) {
    cancelAgentLoopInteractionsForRun({ sessionId, runId: active.metadata.runId })
  }
  if (cancelledPending && pending) {
    cancelAgentLoopInteractionsForRun({ sessionId, runId: pending.metadata.runId })
  }
  return cancelledPreAdmission || cancelledActive || cancelledPending
}

function requestHostDrain() {
  tryGetSessionHostEventRuntime()?.liveness.requestDrain()
}
