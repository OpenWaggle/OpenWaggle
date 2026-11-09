import type { SessionId } from '@shared/types/brand'
import type { SessionControlMutationResponse } from '@shared/types/session-control'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import {
  durableSessionRunId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import { createLogger } from '../logger'
import type { SessionOrganizationRequest } from '../ports/session-organization-repository'
import { withSessionCommandSerialization } from './session-command-serialization'
import { publishControlResponse } from './session-control-event-projection'
import { isSessionRunLive, waitForSessionRunEnd } from './session-run-end'

const logger = createLogger('session-self-archive')

/** Sessions with an archive waiting for the Run that asked for it, so a repeat waits on the same. */
const deferredArchives = new Set<SessionId>()

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
 * Archive a Session after the Run that asked for it ends. Archiving stops the Session's Runs and
 * waits for them, and a Run cannot end while its own tool call waits: archiving inline left both
 * waiting until the 30 s settle bound failed the archive and the Run's abort cancelled the tool
 * call. The archive runs on a daemon fiber, outside the Run and its tool call, under the
 * Session's command serialization, once the Run has saved its terminal state. It still stops any
 * other Run that started meanwhile, as every archive does.
 */
export function deferArchiveUntilRunEnds<E, R>(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly request: SessionOrganizationRequest
  readonly archive: Effect.Effect<SessionControlMutationResponse, E, R>
}): Effect.Effect<SessionControlMutationResponse, never, R> {
  const { sessionId, runId } = input
  const archiveAfterRun = Effect.promise(() => waitForSessionRunEnd(sessionId, runId)).pipe(
    Effect.zipRight(withSessionCommandSerialization(sessionId, input.archive)),
    Effect.tap((response) => Effect.sync(() => publishControlResponse(response))),
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('A Session could not archive itself after its Run ended', {
          sessionId,
          runId,
          cause: Cause.pretty(cause),
        })
      }),
    ),
    Effect.ensuring(Effect.sync(() => deferredArchives.delete(sessionId))),
  )
  return Effect.gen(function* () {
    if (!deferredArchives.has(sessionId)) {
      deferredArchives.add(sessionId)
      yield* Effect.forkDaemon(archiveAfterRun)
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
  })
}
