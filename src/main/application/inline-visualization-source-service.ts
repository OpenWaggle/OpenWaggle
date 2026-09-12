import { decodeUnknownOrThrow } from '@shared/schema'
import { inlineVisualizationSourceOwnerResultSchema } from '@shared/schemas/inline-visualization'
import type { SessionId } from '@shared/types/brand'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import { InlineVisualizationService } from '../ports/inline-visualization-service'
import { SessionRepository } from '../ports/session-repository'
import { invokeConfiguredHostUi } from './gui-session-command-router'

function readVisualizationOwnerSession(sessionId: SessionId) {
  return Effect.gen(function* () {
    // The GUI has an isolated database; only the attached Host owns Session metadata.
    const remote = yield* Effect.tryPromise(() =>
      invokeConfiguredHostUi('inline-visualization:prepare-source', [sessionId]),
    )
    if (remote.handled) {
      const owner = yield* Effect.try(() =>
        decodeUnknownOrThrow(inlineVisualizationSourceOwnerResultSchema, remote.result),
      )
      return { session: owner?.id === sessionId ? owner : null, readOnly: true }
    }
    const sessions = yield* SessionRepository
    const tree = yield* sessions.getTree(sessionId)
    return { session: tree?.session ?? null, readOnly: false }
  })
}

export function readInlineVisualizationSource(input: {
  readonly sessionId: SessionId
  readonly sourcePath: string
}) {
  return Effect.gen(function* () {
    const { session, readOnly } = yield* readVisualizationOwnerSession(input.sessionId)
    if (!session) return { status: 'unavailable', reason: 'session-missing' } as const

    const workingPath = resolveSessionWorkingDir(session, session.projectPath)
    const visualizations = yield* InlineVisualizationService
    return yield* visualizations.readSource({
      ...input,
      workspaceRoots: workingPath ? [workingPath] : [],
      readOnly,
    })
  })
}
