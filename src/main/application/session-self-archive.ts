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
import { withSessionCommandSerialization } from './session-command-serialization'
import { publishControlResponse } from './session-control-event-projection'
import { isSessionRunLive, waitForSessionRunEnd } from './session-run-end'

const logger = createLogger('session-self-archive')

/**
 * The live Run of `sessionId` whose own agent is the caller, if any. A requested Waggle's agent
 * calls as `waggle-of-<run>` from inside that classic Run, so the classic Run counts too.
 */
export function liveCallerRunOfSession(callerId: string, sessionId: SessionId) {
  const caller = parseSessionAgentCallerId(callerId)
  if (caller?.sessionId !== sessionId) return undefined
  return [caller.runId, durableSessionRunId(caller.runId)].find((runId) =>
    isSessionRunLive(sessionId, runId),
  )
}

/**
 * Why the archive the Run asked for no longer applies, or undefined when it still does. A Run
 * that did not complete (the user stopped it, it failed, a drain interrupted it), a Run or
 * Follow-up that came after it, or an archive that already happened all mean someone else
 * decided what happens to the Session since the agent asked.
 */
export function selfArchiveSkipReason(state: SessionSelfArchiveState | null) {
  if (state === null) return 'session-missing'
  if (state.archived) return 'already-archived'
  if (state.activeRunId !== null || state.laterRunCount > 0) return 'later-run'
  if (state.queuedFollowUpCount > 0) return 'follow-up-queued'
  if (state.runStatus !== null && state.runStatus !== 'completed') return 'run-not-completed'
  return undefined
}

/**
 * Holds the Session Host open from the request until the archive is done, so a Host that drains
 * once the Run ends does not stop before it. A Host that is already stopping refuses it.
 */
function acquireArchiveLiveness() {
  return tryGetSessionHostEventRuntime()?.liveness.acquire('operation') ?? (() => undefined)
}

/**
 * Archive a Session after the Run that asked for it ends. Archiving stops the Session's Runs and
 * waits for them, and a Run cannot end while its own tool call waits: archiving inline left both
 * waiting until the 30 s settle bound failed the archive and the Run's abort cancelled the tool
 * call. The archive instead runs on a daemon fiber, outside the Run and its tool call, once the
 * Run has saved its terminal state. Under the Session's command serialization it re-reads the
 * Session first and archives only if nothing changed since (`selfArchiveSkipReason`), so it
 * never stops a Run or Follow-up that came after the request. The intent is kept in memory: a
 * Host restart before the Run ends drops it.
 */
export function deferArchiveUntilRunEnds<E, R>(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly request: SessionOrganizationRequest
  readonly archive: Effect.Effect<SessionControlMutationResponse, E, R>
}): Effect.Effect<SessionControlMutationResponse, unknown, R | SessionOrganizationRepository> {
  const { sessionId, runId } = input
  const archiveIfStillWanted = Effect.gen(function* () {
    const repository = yield* SessionOrganizationRepository
    const state = yield* repository.readSelfArchiveState({
      sessionId,
      runId: durableSessionRunId(runId),
    })
    const skipReason = selfArchiveSkipReason(state)
    if (skipReason !== undefined) {
      logger.info('A Session did not archive itself after its Run ended', {
        sessionId,
        runId,
        reason: skipReason,
      })
      return
    }
    const response = yield* input.archive
    publishControlResponse(response)
  })
  const archiveAfterRun = (releaseLiveness: () => void) =>
    Effect.promise(() => waitForSessionRunEnd(sessionId, runId)).pipe(
      Effect.zipRight(withSessionCommandSerialization(sessionId, archiveIfStillWanted)),
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          logger.warn('A Session could not archive itself after its Run ended', {
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
      const releaseLiveness = yield* Effect.try({
        try: acquireArchiveLiveness,
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      yield* Effect.forkDaemon(archiveAfterRun(releaseLiveness))
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
