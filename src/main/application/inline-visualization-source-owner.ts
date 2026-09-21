import type { InlineVisualizationSourceOwner } from '@shared/types/inline-visualization'
import * as Effect from 'effect/Effect'
import { InlineVisualizationService } from '../ports/inline-visualization-service'
import { SessionRepository } from '../ports/session-repository'
import { validateSessionId } from './host-ui-session-operation-validation'
import { withInlineVisualizationOwnerOperation } from './inline-visualization-owner-operation'

function prepareSourceForExistingSession(sessionId: SessionId) {
  return Effect.gen(function* () {
    const repository = yield* SessionRepository
    const owners = yield* repository.listByIds([sessionId])
    const owner = owners[0]
    if (owners.length !== 1 || owner?.id !== sessionId) return null

    // Only the owner may recover an abandoned deletion; its live deletion lock
    // prevents a source replay from restoring storage during an active delete.
    const visualizations = yield* InlineVisualizationService
    yield* visualizations.prepareSession(sessionId)
    return {
      id: owner.id,
      projectPath: owner.projectPath,
      ...(owner.environmentMode === undefined ? {} : { environmentMode: owner.environmentMode }),
      ...(owner.worktreePath === undefined ? {} : { worktreePath: owner.worktreePath }),
    } satisfies InlineVisualizationSourceOwner
  })
}

export function prepareInlineVisualizationSourceOwner(input: unknown) {
  return validateSessionId(input).pipe(
    Effect.flatMap((sessionId) =>
      withInlineVisualizationOwnerOperation(
        sessionId,
        prepareSourceForExistingSession(sessionId).pipe(Effect.uninterruptible),
      ),
    ),
  )
}

import type { SessionId } from '@shared/types/brand'
