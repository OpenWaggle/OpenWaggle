import type { SessionId } from '@shared/types/brand'
import type { SessionControlMutationResponse } from '@shared/types/session-control'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import {
  durableSessionRunId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import { createLogger } from '../logger'
import {
  SessionOrganizationRepository,
  type SessionOrganizationRequest,
  type SessionSelfArchiveState,
} from '../ports/session-organization-repository'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'
import { hasAnyActiveRun } from './active-session-runs'
import { requestHiveWorkerCleanup } from './hive-worker-cleanup-request'
import { withSessionCommandSerialization } from './session-command-serialization'
import { publishControlResponse } from './session-control-event-projection'
import { SessionHostDrainingError } from './session-host-run-admission'
import { isSessionRunLive, waitForSessionRunEnd } from './session-run-end'

const logger = createLogger('session-self-archive')

/**
 * The live Run of `sessionId` whose own agent is the caller, if any. A requested Waggle's agent
 * calls as `waggle-of-<run>` from inside that classic Run, so the classic Run counts too.
 */
export function liveCallerRunOfSession(callerId: string, sessionId: SessionId) {
  const caller = parseSessionAgentCallerId(callerId)
  if (caller?.sessionId !== sessionId) return undefined
  // The classic Run first: it outlives the Waggle, and the archive waits for the Run to end.
  return [durableSessionRunId(caller.runId), caller.runId].find((runId) =>
    isSessionRunLive(sessionId, runId),
  )
}

/**
 * Runs of each Session with an archive waiting for them to end, until it runs or is withdrawn.
 * Each request holds a token, so after an unarchive only the daemon of the newer request acts.
 */
const pendingSelfArchives = new Map<SessionId, Map<string, symbol>>()

function pendingSelfArchiveToken(sessionId: SessionId, runId: string) {
  return pendingSelfArchives.get(sessionId)?.get(runId)
}

/** Whether any Run of the Session has an archive waiting for it to end. */
export function hasPendingSelfArchive(sessionId: SessionId) {
  return pendingSelfArchives.has(sessionId)
}

function settleSelfArchive(sessionId: SessionId, runId: string, token: symbol) {
  const runs = pendingSelfArchives.get(sessionId)
  if (runs?.get(runId) !== token) return
  runs.delete(runId)
  if (runs.size === 0) pendingSelfArchives.delete(sessionId)
}

/** An unarchive of the Session withdraws every archive its Runs asked for and still wait on. */
export function withdrawSelfArchives(sessionId: SessionId) {
  pendingSelfArchives.delete(sessionId)
}

/**
 * Why the archive the Run asked for no longer applies, or undefined when it still does. Each
 * reason means someone else decided what happens to the Session since the agent asked: the Run
 * did not complete (the user stopped it, it failed, a drain interrupted it), later Session work
 * (a Run, Follow-up, unread Worker update or Worker still working), an unarchive or pin, or an
 * archive that already happened. A Run without a `session_runs` row has no status to check, so
 * it is skipped too.
 */
export function selfArchiveSkipReason(
  state: SessionSelfArchiveState | null,
  live: { readonly pending: boolean; readonly sessionBusy: boolean },
) {
  if (!live.pending) return 'withdrawn'
  if (state === null) return 'session-missing'
  if (state.archived) return 'already-archived'
  if (state.pinned) return 'pinned'
  if (state.activeRunId !== null || state.laterRunCount > 0) return 'later-run'
  if (state.queuedFollowUpCount > 0) return 'follow-up-queued'
  // An unread Worker update keeps the Session visible, for a later Run or the user to read.
  if (state.pendingWorkerUpdateCount > 0) return 'worker-updates-pending'
  // A Worker still working reports later, and a wake skips an archived parent.
  if (state.workingDelegationCount > 0) return 'workers-working'
  if (live.sessionBusy) return 'session-busy'
  if (state.runStatus === null) return 'run-missing'
  if (state.runStatus !== 'completed') return 'run-not-completed'
  return undefined
}

/**
 * Holds the Session Host open from the request until the archive is done, so a Host that drains
 * once the Run ends does not stop before it, unless a drain deadline ends the Host first. A
 * draining Host admits it: the asking Run holds the Host open anyway, and a Run a drain
 * interrupts skips the archive as not completed.
 */
function acquireArchiveLiveness() {
  return (
    tryGetSessionHostEventRuntime()?.liveness.acquire('operation', { whileDraining: true }) ??
    (() => undefined)
  )
}

/**
 * Archive a Session after the Run that asked for it ends. Archiving stops the Session's Runs and
 * waits for them, and a Run cannot end while its own tool call waits: archiving inline left both
 * waiting until the 30 s settle bound failed the archive and the Run's abort cancelled the tool
 * call. The archive instead runs on a daemon fiber, outside the Run and its tool call, once the
 * Run has saved its terminal state. Under the Session's command serialization it re-reads the
 * Session first and archives only if nothing changed since (`selfArchiveSkipReason`), so it
 * never stops a Run or Follow-up that came after the request. An unarchive withdraws it
 * (`withdrawSelfArchives`). The intent is kept in memory: a
 * Host restart before the Run ends drops it.
 */
export function deferArchiveUntilRunEnds<E, R>(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly request: SessionOrganizationRequest
  readonly archive: Effect.Effect<SessionControlMutationResponse, E, R>
}) {
  const { sessionId, runId } = input
  const archiveIfStillWanted = (token: symbol) =>
    Effect.gen(function* () {
      const repository = yield* SessionOrganizationRepository
      const state = yield* repository.readSelfArchiveState({
        sessionId,
        runId: durableSessionRunId(runId),
      })
      const skipReason = selfArchiveSkipReason(state, {
        pending: pendingSelfArchiveToken(sessionId, runId) === token,
        sessionBusy: hasAnyActiveRun(sessionId),
      })
      if (skipReason !== undefined) {
        logger.info('A Session did not archive itself after its Run ended', {
          sessionId,
          runId,
          reason: skipReason,
        })
        return 'skipped' as const
      }
      const response = yield* input.archive
      publishControlResponse(response)
      return 'archived' as const
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          logger.warn('A Session could not archive itself after its Run ended', {
            sessionId,
            runId,
            cause: Cause.pretty(cause),
          })
          return 'failed' as const
        }),
      ),
      // Settled before the serialization is released, so the next command sees no pending archive.
      Effect.ensuring(Effect.sync(() => settleSelfArchive(sessionId, runId, token))),
    )
  const archiveAfterRun = (token: symbol, releaseLiveness: () => void) =>
    Effect.promise(() => waitForSessionRunEnd(sessionId, runId)).pipe(
      Effect.zipRight(withSessionCommandSerialization(sessionId, archiveIfStillWanted(token))),
      // Hive cleanup keeps a Worker with a pending self-archive. When it did not happen, a
      // finished Worker gets the cleanup pass it was kept from, outside the serialization that an
      // inline pass takes itself.
      Effect.flatMap((outcome) =>
        // Interruptible again, so the cleanup pass and its retries run as the coordinator's do.
        outcome === 'archived'
          ? Effect.void
          : Effect.interruptible(requestHiveWorkerCleanup(sessionId)),
      ),
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          logger.warn('A deferred self-archive failed', {
            sessionId,
            runId,
            cause: Cause.pretty(cause),
          })
        }),
      ),
      Effect.ensuring(Effect.sync(releaseLiveness)),
    )
  return Effect.uninterruptible(
    Effect.gen(function* () {
      // A repeat from the same Run gets the same answer, without forking a second daemon.
      if (pendingSelfArchiveToken(sessionId, runId) === undefined) {
        const releaseLiveness = yield* Effect.try({
          try: acquireArchiveLiveness,
          catch: () => new SessionHostDrainingError(),
        })
        const token = Symbol(runId)
        const runs = pendingSelfArchives.get(sessionId) ?? new Map<string, symbol>()
        pendingSelfArchives.set(sessionId, runs.set(runId, token))
        // Forked inside this uninterruptible region, the daemon is uninterruptible too, like every
        // archive Session Control dispatches. Nothing interrupts it; its waits end on their own.
        yield* Effect.forkDaemon(archiveAfterRun(token, releaseLiveness))
      }
      return {
        contractVersion: input.request.contractVersion,
        requestId: input.request.requestId,
        idempotencyKey: input.request.idempotencyKey,
        replayed: false,
        outcome: {
          operation: 'archive',
          effect: 'session-archive-deferred',
          sessionId,
          runId,
        },
      } satisfies SessionControlMutationResponse
    }),
  )
}
