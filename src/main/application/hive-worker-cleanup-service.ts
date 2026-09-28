import type { SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { createLogger } from '../logger'
import { HiveWorkerCleanup } from '../ports/hive-worker-cleanup'
import {
  type HiveWorkerCleanupCandidate,
  HiveWorkerCleanupRepository,
} from '../ports/hive-worker-cleanup-repository'
import { hasAnyActiveRun, isSessionRemovalFenced } from './active-session-runs'
import { listPendingAgentLoopInteractions } from './agent-loop-interaction-broker'
import { withSessionCommandSerialization } from './session-command-serialization'
import { publishControlResponse } from './session-control-event-projection'
import { archiveSession } from './session-organization-service'

const logger = createLogger('hive-worker-cleanup')

/** In-memory Host work that the durable eligibility query cannot see. */
function hasLiveWorkerActivity(sessionId: SessionId) {
  return (
    hasAnyActiveRun(sessionId) ||
    isSessionRemovalFenced(sessionId) ||
    listPendingAgentLoopInteractions(sessionId).length > 0
  )
}

/**
 * The idempotency key names one terminal Delegation transition, so a Worker is archived at most
 * once per transition. If its parent agent restores it, the replay keeps it restored.
 */
function cleanupIdempotencyKey(candidate: HiveWorkerCleanupCandidate) {
  return `hive-cleanup:${candidate.delegationId}:${String(candidate.delegationUpdatedAt)}`
}

function archiveEligibleWorker(workerSessionId: SessionId) {
  return withSessionCommandSerialization(
    workerSessionId,
    Effect.gen(function* () {
      const repository = yield* HiveWorkerCleanupRepository
      // Re-check under the Worker's command serialization: a user message, pin, or restore that
      // committed after the candidate scan wins and keeps the Worker.
      const current = (yield* repository.findEligibleWorkers({
        sessionId: workerSessionId,
        includeDirectWorkers: false,
      })).find((candidate) => candidate.workerSessionId === workerSessionId)
      if (!current || hasLiveWorkerActivity(workerSessionId)) return undefined
      const idempotencyKey = cleanupIdempotencyKey(current)
      const response = yield* archiveSession({
        callerId: current.parentCallerId,
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: idempotencyKey,
          idempotencyKey,
          command: { operation: 'archive', sessionId: workerSessionId },
        },
      })
      publishControlResponse(response)
      return response
    }),
  )
}

/**
 * Hive cleanup phase: archive finished Workers the user never interacted with, attributed to the
 * parent agent that spawned them. `sessionId` is examined both as a Worker and as a parent.
 * Failures are logged per Worker and never escape; every trigger re-derives eligibility.
 */
export function reconcileHiveWorkerCleanup(sessionId: SessionId) {
  return Effect.gen(function* () {
    const repository = yield* HiveWorkerCleanupRepository
    const candidates = yield* repository.findEligibleWorkers({
      sessionId,
      includeDirectWorkers: true,
    })
    const archived: SessionControlMutationResponse[] = []
    for (const candidate of candidates) {
      const response = yield* archiveEligibleWorker(candidate.workerSessionId).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            logger.warn('Hive cleanup could not archive a finished Worker', {
              workerSessionId: candidate.workerSessionId,
              parentSessionId: candidate.parentSessionId,
              cause: Cause.pretty(cause),
            })
            return undefined
          }),
        ),
      )
      if (response && !response.replayed && response.outcome.effect === 'session-archived') {
        archived.push(response)
      }
    }
    return archived
  })
}

type HiveWorkerCleanupDependencies = Effect.Effect.Context<
  ReturnType<typeof reconcileHiveWorkerCleanup>
>

/**
 * `background` (the Host default) forks each pass so Run settlement and Delegation review never
 * wait on archive teardown. `inline` completes the pass before returning, for deterministic tests.
 */
export function makeHiveWorkerCleanupLayer(strategy: 'background' | 'inline' = 'background') {
  return Layer.effect(
    HiveWorkerCleanup,
    Effect.gen(function* () {
      const context = yield* Effect.context<HiveWorkerCleanupDependencies>()
      return HiveWorkerCleanup.of({
        requestReconciliation: (sessionId) => {
          const pass = reconcileHiveWorkerCleanup(sessionId).pipe(
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
        },
      })
    }),
  )
}

export const HiveWorkerCleanupLive = makeHiveWorkerCleanupLayer()
