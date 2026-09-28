import { isActiveActionRun } from '@shared/types/action-runs'
import type { SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Cause from 'effect/Cause'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { createLogger } from '../logger'
import { ActionRunService } from '../ports/action-run-service'
import { DesktopServiceBroker } from '../ports/desktop-service-broker'
import { HiveWorkerCleanup } from '../ports/hive-worker-cleanup'
import {
  HIVE_CLEANUP_IDEMPOTENCY_PREFIX,
  type HiveWorkerCleanupCandidate,
  HiveWorkerCleanupRepository,
  type HiveWorkerMutationEnvelope,
} from '../ports/hive-worker-cleanup-repository'
import { SessionOrganizationRepository } from '../ports/session-organization-repository'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'
import { TerminalService } from '../ports/terminal-service'
import { hasAnyActiveRun, isSessionRemovalFenced } from './active-session-runs'
import { listPendingAgentLoopInteractions } from './agent-loop-interaction-broker'
import { withSessionCommandSerialization } from './session-command-serialization'
import { publishControlResponse } from './session-control-event-projection'
import { withSessionDesktopRemoval } from './session-desktop-removal'

const logger = createLogger('hive-worker-cleanup')
const HIVE_RESTORE_IDEMPOTENCY_PREFIX = 'hive-restore:'

/**
 * Live desktop state the user created in the Worker. None of it is journaled, and archiving
 * would destroy it, so it counts as user activity. The next trigger re-derives eligibility.
 */
class HiveWorkerKept extends Data.TaggedError('HiveWorkerKept')<{
  readonly reason: 'open-terminal' | 'open-in-app' | 'running-service'
}> {}

/** In-memory Host work that the durable eligibility query cannot see. */
function hasLiveWorkerActivity(sessionId: SessionId) {
  return (
    hasAnyActiveRun(sessionId) ||
    isSessionRemovalFenced(sessionId) ||
    listPendingAgentLoopInteractions(sessionId).length > 0
  )
}

/**
 * Runs inside the archive's terminal/browser mutation fence, before teardown, so no terminal or
 * preview can be opened for the Worker between this check and the teardown. A truncated terminal
 * snapshot could hide the Worker's shell, so it keeps the Worker too.
 */
function requireNoLiveDesktopState(workerSessionId: SessionId) {
  return Effect.gen(function* () {
    const terminals = yield* TerminalService
    const snapshot = yield* terminals.getActivitySnapshot()
    if (
      snapshot.truncated ||
      snapshot.summaries.some((summary) => summary.ownerKey === workerSessionId)
    ) {
      return yield* new HiveWorkerKept({ reason: 'open-terminal' })
    }
    const desktop = yield* DesktopServiceBroker
    const browser = yield* desktop.execute({
      service: 'browser',
      operation: 'inspectOwner',
      ownerKey: workerSessionId,
    })
    if (browser.service !== 'browser' || browser.operation !== 'inspectOwner') {
      return yield* Effect.fail(new Error('The desktop returned the wrong browser inspection.'))
    }
    // A registered owner means the Worker is open in the app, or the app retains its previews.
    if (browser.value.registered || browser.value.previews > 0) {
      return yield* new HiveWorkerKept({ reason: 'open-in-app' })
    }
  })
}

/**
 * Runs inside the archive's Workspace action mutation, so no project action can start between
 * this check and the release that would stop it. Services survive while another active Session
 * shares the Workspace, so only a Worker that is the last active binding is kept.
 */
function requireNoServiceToStop(workerSessionId: SessionId) {
  return Effect.gen(function* () {
    const workspaces = yield* SessionWorkspaceResourceRepository
    const workspace = yield* workspaces.getBound(workerSessionId)
    if (!workspace) return
    if ((yield* workspaces.countActiveBindings(workspace.id, workerSessionId)) > 0) return
    const actions = yield* ActionRunService
    const runs = yield* actions.list(workspace.id)
    if (runs.some((run) => run.action.kind === 'service' && isActiveActionRun(run))) {
      return yield* new HiveWorkerKept({ reason: 'running-service' })
    }
  })
}

function keepWhenBusy<A, E, R>(effect: Effect.Effect<A, E | HiveWorkerKept, R>) {
  return effect.pipe(
    Effect.catchIf(
      (error): error is HiveWorkerKept => error instanceof HiveWorkerKept,
      (kept) => Effect.succeed({ status: 'kept', reason: kept.reason } as const),
    ),
  )
}

/**
 * The idempotency key names one terminal Delegation transition, so a Worker is archived at most
 * once per transition. If its parent agent restores it, the replay keeps it restored.
 */
function cleanupEnvelope(candidate: HiveWorkerCleanupCandidate): HiveWorkerMutationEnvelope {
  const key = `${HIVE_CLEANUP_IDEMPOTENCY_PREFIX}${candidate.delegationId}:${String(candidate.delegationUpdatedAt)}`
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: key,
    idempotencyKey: key,
  }
}

function archiveEligibleWorker(workerSessionId: SessionId) {
  return withSessionCommandSerialization(
    workerSessionId,
    Effect.gen(function* () {
      const repository = yield* HiveWorkerCleanupRepository
      // Cheap re-check under the Worker's command serialization before any teardown. The
      // archive transaction re-derives the full predicate again, which is what makes a pin or
      // branch edit (local-ui-v1 writes that skip this serialization) win the race.
      const current = (yield* repository.findEligibleWorkers({
        sessionId: workerSessionId,
        includeDirectWorkers: false,
      })).find((candidate) => candidate.workerSessionId === workerSessionId)
      if (!current || hasLiveWorkerActivity(workerSessionId)) return undefined
      const envelope = cleanupEnvelope(current)
      const organization = yield* SessionOrganizationRepository
      const admission = yield* organization.prepareArchive({
        callerId: current.parentCallerId,
        request: {
          ...envelope,
          command: { operation: 'archive', sessionId: workerSessionId },
        },
      })
      if (admission.status === 'completed') return admission.response
      // Unfenced first look: a Worker the user is using is skipped without taking the desktop
      // fence, which would briefly hold admission for the user's terminals and previews.
      const precheck = yield* keepWhenBusy(
        requireNoLiveDesktopState(workerSessionId).pipe(
          Effect.zipRight(requireNoServiceToStop(workerSessionId)),
          Effect.as({ status: 'clear' } as const),
        ),
      )
      const result =
        precheck.status === 'kept'
          ? precheck
          : yield* keepWhenBusy(
              withSessionDesktopRemoval(
                workerSessionId,
                requireNoServiceToStop(workerSessionId).pipe(
                  Effect.zipRight(
                    repository.archiveIfStillEligible({ candidate: current, envelope }),
                  ),
                ),
                'archive',
                requireNoLiveDesktopState(workerSessionId),
              ),
            )
      if (result.status === 'kept') {
        logger.debug('Hive cleanup kept a finished Worker', {
          workerSessionId,
          reason: result.reason,
        })
        return undefined
      }
      publishControlResponse(result.response)
      return result.response
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

/**
 * A user or agent resumed work on a Worker that Hive cleanup archived: bring it back in the same
 * command, attributed to that caller. The caller already holds the Worker's command
 * serialization. The restored Worker stays visible until its Delegation reaches a new terminal
 * transition: the cleanup archive key replays for the transition that archived it.
 */
export function restoreHiveWorkerForCommand(input: {
  readonly callerId: string
  readonly sessionId: SessionId
  readonly idempotencyKey: string
}) {
  return Effect.gen(function* () {
    const repository = yield* HiveWorkerCleanupRepository
    const key = `${HIVE_RESTORE_IDEMPOTENCY_PREFIX}${input.idempotencyKey}`
    const response = yield* repository.restoreCleanupArchive({
      callerId: input.callerId,
      sessionId: input.sessionId,
      envelope: {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: key,
        idempotencyKey: key,
      },
    })
    if (response && !response.replayed) publishControlResponse(response)
    return response
  })
}

type HiveWorkerCleanupDependencies =
  | Effect.Effect.Context<ReturnType<typeof reconcileHiveWorkerCleanup>>
  | Effect.Effect.Context<ReturnType<typeof restoreHiveWorkerForCommand>>

/**
 * `background` (the Host default) forks each pass so Run settlement and Delegation review never
 * wait on archive teardown. `inline` completes the pass before returning, for deterministic tests.
 * Restoration for a resuming command always runs inline: it is part of that command.
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
