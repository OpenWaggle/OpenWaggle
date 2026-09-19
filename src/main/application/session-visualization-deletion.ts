import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { createLogger } from '../logger'
import {
  type InlineVisualizationDeletionStage,
  InlineVisualizationService,
} from '../ports/inline-visualization-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { TerminalService } from '../ports/terminal-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { withInlineVisualizationOwnerOperation } from './inline-visualization-owner-operation'

const logger = createLogger('session-visualization-deletion')

function commitVisualizationDeletion(
  sessionId: SessionId,
  stage: InlineVisualizationDeletionStage,
) {
  return stage.commit.pipe(
    Effect.catchAll((error) => {
      logger.warn('Deferred visualization tombstone cleanup after session deletion', {
        sessionId: String(sessionId),
        error: String(error),
      })
      return Effect.void
    }),
    Effect.zipRight(
      Effect.gen(function* () {
        const terminals = yield* TerminalService
        yield* terminals.closeAllForOwner(sessionId, true)
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.warn('Deferred terminal history cleanup after session deletion', {
              sessionId: String(sessionId),
              error: error.message,
            })
          }),
        ),
      ),
    ),
    Effect.ensuring(
      Effect.sync(() =>
        publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'deleted' }),
      ),
    ),
  )
}

function settleFailedDeletion(sessionId: SessionId, stage: InlineVisualizationDeletionStage) {
  return Effect.gen(function* () {
    // Persistence can remove the owner before later Git/Pi cleanup fails.
    // A failed ownership probe must leave the staged files quarantined.
    const repository = yield* SessionRepository
    const owners = yield* repository.listByIds([sessionId])
    return yield* owners.some((owner) => owner.id === sessionId)
      ? stage.rollback
      : commitVisualizationDeletion(sessionId, stage)
  }).pipe(Effect.orDie)
}

/** Caller holds the Session tree writer until persistence and file cleanup settle. */
export function deleteSessionWithVisualizations(sessionId: SessionId) {
  return withInlineVisualizationOwnerOperation(
    sessionId,
    Effect.gen(function* () {
      const visualizations = yield* InlineVisualizationService
      const projection = yield* SessionProjectionRepository
      return yield* Effect.acquireUseRelease(
        visualizations.stageSessionDeletion(sessionId),
        () => projection.delete(sessionId),
        (stage, exit) =>
          Exit.isFailure(exit)
            ? settleFailedDeletion(sessionId, stage)
            : commitVisualizationDeletion(sessionId, stage),
      )
    }).pipe(Effect.uninterruptible),
  )
}
