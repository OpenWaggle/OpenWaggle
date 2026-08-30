import { randomUUID } from 'node:crypto'
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import { RunId, type SessionId, type SupportedModelId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { cancelAgentLoopInteractionsForRun } from '../application/agent-loop-interaction-broker'
import { dispatchLocalSessionCommand } from '../application/local-session-command-dispatcher'
import { coordinateSessionRuns } from '../application/session-control-run-coordinator'
import {
  activatePreparedExternalSessionRun,
  prepareExternalSessionRunReplacement,
  settleExternalSessionRun,
} from '../application/session-external-run-coordinator'
import { acquireSessionHostRunLease } from '../application/session-host-run-admission'
import { forkSupervisedSessionRuns } from '../application/session-run-coordinator-supervision'
import { executeWaggleRun } from '../application/waggle-run-service'
import { isGuiAttachedToRemoteSessionHost } from '../session-host/gui-session-host-state'
import {
  publishSessionHostEvent,
  tryGetSessionHostEventRuntime,
} from '../session-host/session-host-events'
import { emitWorktreeLaunchFailure, emitWorktreeLaunchProgress } from '../utils/stream-bridge'
import {
  activeWaggleRuns,
  claimSessionWriterSuccessorAndWait,
  currentSessionWriterRunId,
  releaseClaimedSessionWriterSuccessor,
  reserveActiveSessionRun,
  reserveWaggleSessionWriter,
} from './active-agent-runs'
import { typedHandle, typedOn } from './typed-ipc'
import {
  describeWaggleSendOutcome,
  publishWaggleResult,
  waggleTerminalResult,
} from './waggle-handler-result'

export function registerWaggleHandlers() {
  registerSendWaggleMessageHandler()
  registerCancelWaggleHandler()
}

function registerSendWaggleMessageHandler() {
  typedHandle(
    'agent:send-waggle-message',
    (
      _event,
      sessionId: SessionId,
      payload: AgentSendPayload,
      model: SupportedModelId,
      config: WaggleConfig,
    ) => handleSendWaggleMessage(sessionId, payload, model, config),
  )
}

function registerCancelWaggleHandler() {
  typedOn('agent:cancel-waggle', (_event, sessionId: SessionId) => {
    if (isGuiAttachedToRemoteSessionHost()) return interruptRemoteSessionRun(sessionId)
    return Effect.sync(() => {
      const active = activeWaggleRuns.get(sessionId)
      if (activeWaggleRuns.cancel(sessionId)) {
        cancelAgentLoopInteractionsForRun({
          sessionId,
          runId: active?.metadata.runId ?? `waggle-${sessionId}`,
        })
      }
    })
  })
}

function interruptRemoteSessionRun(sessionId: SessionId) {
  return Effect.gen(function* () {
    const statusResult = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'session-query-v2',
        request: {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: randomUUID(),
          query: { operation: 'status', sessionId },
        },
      },
    })
    if (
      statusResult.contract !== 'session-query-v2' ||
      statusResult.response.outcome.operation !== 'status' ||
      'error' in statusResult.response.outcome ||
      !statusResult.response.outcome.activeRunId
    ) {
      return
    }
    yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'session-control-v2',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command: {
            operation: 'interrupt',
            sessionId,
            expectedRunId: statusResult.response.outcome.activeRunId,
          },
        },
      },
    })
  })
}

function waggleRunId() {
  return `waggle-${randomUUID()}`
}

function explicitWaggleIntent(payload: AgentSendPayload) {
  return {
    text: payload.text,
    attachmentIds: payload.attachments.map((attachment) => attachment.id),
    thinkingLevel: payload.thinkingLevel,
    callerId: 'gui:local-user',
    acceptedAt: Date.now(),
    idempotencyKey: randomUUID(),
  } as const
}

function handleSendWaggleMessage(
  sessionId: SessionId,
  payload: AgentSendPayload,
  model: SupportedModelId,
  config: WaggleConfig,
) {
  return Effect.gen(function* () {
    if (isGuiAttachedToRemoteSessionHost()) {
      return yield* Effect.fail(
        new Error(
          'Explicit Waggle runs are unavailable while this GUI is attached to another Session Host.',
        ),
      )
    }
    const validatedPayload = toAgentSendPayload(
      decodeUnknownOrThrow(agentSendPayloadSchema, payload),
    )
    const abortController = new AbortController()
    const runId = RunId(waggleRunId())
    const intent = explicitWaggleIntent(validatedPayload)
    const lease = yield* acquireSessionHostRunLease('run').pipe(
      Effect.tapError(() => Effect.sync(requestHostDrain)),
    )
    const previousRunId = currentSessionWriterRunId(sessionId)
    const preparation = yield* prepareExternalSessionRunReplacement({
      sessionId,
      ...(previousRunId ? { previousRunId: RunId(previousRunId) } : {}),
      runId,
      intent,
    }).pipe(Effect.tapError(() => Effect.sync(lease.release)))
    if (!preparation.accepted) {
      lease.release()
      return yield* Effect.fail(
        new Error(`Could not prepare explicit Waggle replacement: ${preparation.code}.`),
      )
    }
    const successorToken = yield* awaitExistingSessionWriter(sessionId).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          lease.release()
          requestHostDrain()
        }),
      ),
    )
    const writer = yield* Effect.try(() =>
      reserveWaggleSessionWriter(sessionId, abortController, runId, successorToken ?? undefined),
    ).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          lease.release()
          if (successorToken) releaseClaimedSessionWriterSuccessor(sessionId, successorToken)
          requestHostDrain()
        }),
      ),
    )
    let writerReleased = false
    let leaseTransferred = false

    return yield* Effect.gen(function* () {
      const activation = yield* activatePreparedExternalSessionRun({ sessionId, runId })
      if (!activation.accepted) {
        return yield* Effect.fail(
          new Error(`Could not activate explicit Waggle: ${activation.code}.`),
        )
      }
      const result = yield* runRegisteredWaggleMessage(
        sessionId,
        runId,
        validatedPayload,
        model,
        config,
        abortController,
      )
      const terminal = waggleTerminalResult(result)
      const settlement = yield* settleExternalSessionRun({ sessionId, runId, ...terminal })
      if (settlement.accepted && settlement.scheduled) {
        const nextRunId = RunId(settlement.scheduled.runId)
        const reservation = yield* Effect.sync(() => {
          writer.release()
          writerReleased = true
          return reserveActiveSessionRun(sessionId, nextRunId)
        })
        yield* forkSupervisedSessionRuns({
          sessionId,
          runId: nextRunId,
          effect: coordinateSessionRuns({
            sessionId,
            startingRunId: nextRunId,
            initialReservation: reservation,
            lease,
          }),
        }).pipe(
          Effect.catchAllCause((cause) =>
            Effect.sync(reservation.release).pipe(Effect.zipRight(Effect.failCause(cause))),
          ),
        )
        leaseTransferred = true
      }
      return describeWaggleSendOutcome(result)
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          requestHostDrain()
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          cancelAgentLoopInteractionsForRun({ sessionId, runId })
          if (!writerReleased) writer.release()
          if (!leaseTransferred) lease.release()
        }),
      ),
    )
  })
}

function requestHostDrain() {
  tryGetSessionHostEventRuntime()?.liveness.requestDrain()
}

function runRegisteredWaggleMessage(
  sessionId: SessionId,
  runId: string,
  payload: AgentSendPayload,
  model: SupportedModelId,
  config: WaggleConfig,
  abortController: AbortController,
) {
  return Effect.gen(function* () {
    const result = yield* executeWaggleRun({
      sessionId,
      runId,
      payload,
      model,
      config,
      signal: abortController.signal,
      onRunPrepared: (runtimeModel) => startWaggleStream(sessionId, runId, runtimeModel),
      onEvent: (event, meta) => {
        publishSessionHostEvent({ kind: 'session-waggle-transport', sessionId, event, meta })
        if (event.type !== 'agent_end') {
          publishSessionHostEvent({ kind: 'session-transport', sessionId, event })
        }
      },
      onTurnEvent: (event) =>
        publishSessionHostEvent({ kind: 'session-waggle-turn', sessionId, event }),
      onWorktreeLaunch: (progress) => emitWorktreeLaunchProgress(sessionId, progress),
      onTitleAssigned: () =>
        publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' }),
    })

    if (result.outcome === 'error') {
      emitWorktreeLaunchFailure(sessionId, result.message)
    }
    publishWaggleResult(sessionId, runId, result)
    /*
     * Reported back for the same reason the classic path does it: this Effect succeeds whether the turn ran or
     * was refused, so a caller with work to protect could not tell the difference.
     */
    return result
  })
}

function awaitExistingSessionWriter(sessionId: SessionId) {
  return Effect.promise(async () => {
    const successorToken = await claimSessionWriterSuccessorAndWait(sessionId, 'waggle')
    return successorToken
  })
}

function startWaggleStream(sessionId: SessionId, runId: string, runtimeModel: SupportedModelId) {
  publishSessionHostEvent({
    kind: 'session-transport',
    sessionId,
    event: { type: 'agent_start', timestamp: Date.now(), runId, model: runtimeModel },
  })
}
