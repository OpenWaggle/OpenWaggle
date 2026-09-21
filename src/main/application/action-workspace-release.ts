import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { ActionRunService } from '../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'

/** Serialize archive/delete against starts. Other active bindings retain their services. */
export function withSessionActionRelease<A, E, R>(
  sessionId: SessionId,
  operation: Effect.Effect<A, E, R>,
  timing: 'before' | 'after' = 'before',
) {
  return Effect.gen(function* () {
    const workspaces = yield* SessionWorkspaceResourceRepository
    const workspace = yield* workspaces.getBound(sessionId)
    if (!workspace) return yield* operation
    const actions = yield* ActionRunService
    return yield* actions.withWorkspaceMutation(
      workspace.id,
      Effect.gen(function* () {
        if (timing === 'after') {
          const result = yield* operation
          if ((yield* workspaces.countActiveBindings(workspace.id)) === 0)
            yield* actions.stopWorkspaceServices(workspace.id)
          return result
        }
        const remaining = yield* workspaces.countActiveBindings(workspace.id, sessionId)
        if (remaining === 0) yield* actions.stopWorkspaceServices(workspace.id)
        return yield* operation
      }),
    )
  })
}
