import type { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { SessionControlRunIntent } from '../domain/session-control/message-aggregate'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import {
  SessionControlRunLifecycleRepository,
  type SessionControlTerminalRunStatus,
} from '../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { requestHiveWorkerCleanup } from './hive-worker-cleanup-request'
import { settleWithUndeliveredSteers } from './undelivered-steering-settlement'

export function startExternalSessionRun(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly intent: SessionControlRunIntent
  readonly hostRunCeiling?: number
}) {
  return Effect.gen(function* () {
    const lifecycle = yield* SessionControlRunLifecycleRepository
    if (!lifecycle.startExternal) {
      return yield* Effect.fail(new Error('External Session Run activation is unavailable.'))
    }
    const activation = yield* lifecycle.startExternal(input)
    if (activation.accepted) {
      publishSessionHostEvent({
        kind: 'session-state-changed',
        sessionId: input.sessionId,
        stateRevision: activation.stateRevision,
        operation: 'run-activated',
      })
    }
    return activation
  })
}

export function prepareExternalSessionRunReplacement(input: {
  readonly sessionId: SessionId
  readonly previousRunId?: RunId
  readonly runId: RunId
  readonly intent: SessionControlRunIntent
  readonly hostRunCeiling?: number
}) {
  return Effect.gen(function* () {
    const lifecycle = yield* SessionControlRunLifecycleRepository
    if (!lifecycle.replaceWithExternal) {
      return yield* Effect.fail(new Error('External Session Run replacement is unavailable.'))
    }
    return yield* lifecycle.replaceWithExternal(input)
  })
}

export function activatePreparedExternalSessionRun(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
}) {
  return Effect.gen(function* () {
    const lifecycle = yield* SessionControlRunLifecycleRepository
    const activation = yield* lifecycle.activate(input)
    if (activation.accepted) {
      publishSessionHostEvent({
        kind: 'session-state-changed',
        sessionId: input.sessionId,
        stateRevision: activation.stateRevision,
        operation: 'run-activated',
      })
    }
    return activation
  })
}

export function settleExternalSessionRun(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly terminalStatus: SessionControlTerminalRunStatus
  readonly finalResponse?: string
}) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const lifecycle = yield* SessionControlRunLifecycleRepository
    const updateDelivery = yield* SessionOrchestrationUpdateDeliveryService
    const nextRunId = yield* identities.nextRunId
    const settlement = yield* settleWithUndeliveredSteers({
      sessionId: input.sessionId,
      runId: input.runId,
      settle: (undeliveredSteers) =>
        lifecycle.settle({
          sessionId: input.sessionId,
          runId: input.runId,
          nextRunId,
          terminalStatus: input.terminalStatus,
          ...(input.finalResponse ? { finalResponse: input.finalResponse } : {}),
          ...(undeliveredSteers.length > 0 ? { undeliveredSteers } : {}),
        }),
    })
    if (!settlement.accepted) return settlement
    publishSessionHostEvent({
      kind: 'session-state-changed',
      sessionId: input.sessionId,
      stateRevision: settlement.stateRevision,
      operation: settlement.scheduled ? 'follow-up-started' : 'run-settled',
      // Which Run settled and how. The renderer relays a hand-off to a queued Follow-up only when
      // it names the settled Run; without it a Waggle's answers were kept as the next Run's.
      runId: input.runId,
      terminalStatus: input.terminalStatus,
    })
    if (settlement.delegationUpdate) {
      publishSessionHostEvent({
        kind: 'session-list-changed',
        sessionId: settlement.delegationUpdate.parentSessionId,
        change: 'updated',
      })
    }
    if (settlement.orchestrationUpdate) {
      yield* updateDelivery.deliverPendingToActiveRun({
        parentSessionId: settlement.orchestrationUpdate.parentSessionId,
      })
    }
    if (!settlement.scheduled) yield* requestHiveWorkerCleanup(input.sessionId)
    return settlement
  })
}
