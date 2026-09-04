import type { SessionId } from '@shared/types/brand'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import { InlineVisualizationService } from '../ports/inline-visualization-service'
import { SessionRepository } from '../ports/session-repository'

export function readInlineVisualizationSource(input: {
  readonly sessionId: SessionId
  readonly sourcePath: string
}) {
  return Effect.gen(function* () {
    const sessions = yield* SessionRepository
    const tree = yield* sessions.getTree(input.sessionId)
    if (!tree) return { status: 'unavailable', reason: 'session-missing' } as const

    const workingPath = resolveSessionWorkingDir(tree.session, tree.session.projectPath)
    const visualizations = yield* InlineVisualizationService
    return yield* visualizations.readSource({
      ...input,
      workspaceRoots: workingPath ? [workingPath] : [],
    })
  })
}
