import { decodeUnknownOrThrow } from '@shared/schema'
import { inlineVisualizationSourceOwnerResultSchema } from '@shared/schemas/inline-visualization'
import type { SessionId } from '@shared/types/brand'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import { InlineVisualizationService } from '../ports/inline-visualization-service'
import { invokeConfiguredHostUi } from './gui-session-command-router'

function readVisualizationOwnerSession(sessionId: SessionId) {
  return Effect.gen(function* () {
    // The desktop window has no Session store; only the attached Host owns Session metadata.
    const remote = yield* Effect.tryPromise(() =>
      invokeConfiguredHostUi('inline-visualization:prepare-source', [sessionId]),
    )
    // Before the window attached (or once it detached) there is no owner to read (A-F5).
    if (!remote.handled) return { session: null, readOnly: true }
    const owner = yield* Effect.try(() =>
      decodeUnknownOrThrow(inlineVisualizationSourceOwnerResultSchema, remote.result),
    )
    return { session: owner?.id === sessionId ? owner : null, readOnly: true }
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
