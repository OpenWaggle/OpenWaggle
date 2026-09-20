import type { SessionId } from '@shared/types/brand'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { cleanupSessionRun } from '../agent/session-cleanup'
import { cleanupQueuedSessionResources } from '../application/session-resource-cleanup'
import { createLogger } from '../logger'
import { InlineVisualizationService } from '../ports/inline-visualization-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { TerminalService } from '../ports/terminal-service'
import { clearAgentPhase, clearStreamBuffer, emitRunCompleted } from '../utils/stream-bridge'
import {
  acquireSessionRemovalFence,
  cancelSessionRuns,
  waitForSessionRuns,
} from './active-agent-runs'

const logger = createLogger('session-details-handler')
const SESSION_REMOVAL_SETTLE_TIMEOUT_MS = 30_000

function cleanupBeforeSessionRemoval(sessionId: SessionId) {
  const cancelledActiveRun = cancelSessionRuns(sessionId)
  clearAgentPhase(sessionId)
  clearStreamBuffer(sessionId)
  cleanupSessionRun(sessionId)
  if (cancelledActiveRun) {
    emitRunCompleted(sessionId)
  }
}

function quiesceBeforeSessionRemoval(sessionId: SessionId) {
  return Effect.sync(() => cleanupBeforeSessionRemoval(sessionId)).pipe(
    Effect.zipRight(
      Effect.tryPromise({
        try: () => waitForSessionRuns(sessionId, SESSION_REMOVAL_SETTLE_TIMEOUT_MS),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    ),
    Effect.flatMap((settled) =>
      settled
        ? Effect.void
        : Effect.fail(
            new Error(
              `Session work did not stop within ${String(SESSION_REMOVAL_SETTLE_TIMEOUT_MS)} ms. Session metadata was retained after cancellation.`,
            ),
          ),
    ),
  )
}

function withSessionRemovalFence<A, E, R>(sessionId: SessionId, operation: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const terminals = yield* TerminalService
    return yield* terminals.runWithMutationFence(
      { kind: 'owner', ownerKey: String(sessionId) },
      Effect.acquireUseRelease(
        Effect.try({
          try: () => acquireSessionRemovalFence(sessionId),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        () => operation,
        (release) => Effect.sync(release),
      ),
    )
  })
}

function closeOwnedTerminals(sessionId: SessionId, deleteHistory: boolean) {
  return Effect.gen(function* () {
    const terminals = yield* TerminalService
    yield* terminals.closeAllForOwner(String(sessionId), deleteHistory)
  }).pipe(
    // The terminal adapter uses Effect.promise, so rejected shutdown/history promises are defects.
    // Normalize those errors at this boundary without turning interruption into recoverable failure.
    Effect.catchAllCause((cause) =>
      Cause.isInterrupted(cause) ? Effect.failCause(cause) : Effect.fail(Cause.squash(cause)),
    ),
  )
}

/** Deleted sessions take their terminals and scrollback with them (ADR 0030). */
function cleanupTerminalsForDeletedSession(sessionId: SessionId, deleteHistory: boolean) {
  return closeOwnedTerminals(sessionId, deleteHistory).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        logger.warn('Terminal cleanup for session deletion failed', {
          sessionId: String(sessionId),
          error: String(error),
        })
      }),
    ),
  )
}

/** Archived sessions stop hidden processes but retain scrollback for restoration. */
function cleanupTerminalsForArchivedSession(sessionId: SessionId) {
  return closeOwnedTerminals(sessionId, false).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        logger.warn('Terminal cleanup before session archive failed', {
          sessionId: String(sessionId),
          error: String(error),
        })
      }),
    ),
  )
}

function deleteSessionUnderFence(id: SessionId) {
  return Effect.gen(function* () {
    const repo = yield* SessionProjectionRepository
    const blocker = yield* repo.getDeletionBlocker(id)
    if (blocker) return yield* Effect.fail(new Error(blocker))
    const visualizations = yield* InlineVisualizationService
    const stagedDeletion = yield* visualizations.stageSessionDeletion(id)
    yield* quiesceBeforeSessionRemoval(id).pipe(
      Effect.zipRight(cleanupTerminalsForDeletedSession(id, false)),
      Effect.zipRight(repo.delete(id)),
      Effect.tapError(() => stagedDeletion.rollback),
    )
    yield* cleanupQueuedSessionResources(id).pipe(Effect.catchAll(() => Effect.void))
    yield* stagedDeletion.commit.pipe(
      Effect.catchAll((error) => {
        logger.warn('Deferred visualization tombstone cleanup after session deletion', {
          sessionId: String(id),
          error: String(error),
        })
        return Effect.void
      }),
    )
    yield* cleanupTerminalsForDeletedSession(id, true).pipe(
      Effect.catchAll((error) => {
        logger.warn('Deferred terminal history cleanup after session deletion', {
          sessionId: String(id),
          error: String(error),
        })
        return Effect.void
      }),
    )
  })
}

export function deleteSessionWithFences(id: SessionId) {
  return withSessionRemovalFence(
    id,
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      return yield* repo.withDeletionFence(id, deleteSessionUnderFence(id))
    }),
  )
}

export function archiveSessionWithFences(id: SessionId) {
  return withSessionRemovalFence(
    id,
    quiesceBeforeSessionRemoval(id).pipe(
      Effect.zipRight(cleanupTerminalsForArchivedSession(id)),
      Effect.zipRight(
        Effect.gen(function* () {
          const repo = yield* SessionProjectionRepository
          yield* repo.archive(id)
        }),
      ),
    ),
  )
}
