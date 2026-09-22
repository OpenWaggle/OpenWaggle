import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { ActionRunService } from '../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'

const logger = createLogger('action-workspace-release')

/** Serialize archive/delete against starts. Other active bindings retain their services. */
export function withSessionActionRelease<A, E, R>(
  sessionId: SessionId,
  operation: Effect.Effect<A, E, R>,
  timing: 'before' | 'after' = 'before',
  intent: 'archive' | 'delete' = 'archive',
) {
  return Effect.gen(function* () {
    const workspaces = yield* SessionWorkspaceResourceRepository
    while (true) {
      const workspace = yield* workspaces.getBound(sessionId)
      if (!workspace) return yield* operation
      const actions = yield* ActionRunService
      const outcome = yield* actions.withWorkspaceMutation(
        workspace.id,
        Effect.gen(function* () {
          // A preceding handoff can replace the binding while this caller waits for admission.
          if ((yield* workspaces.getBound(sessionId))?.id !== workspace.id)
            return { status: 'retry' } as const
          if (timing === 'after' || intent === 'archive') {
            const value = yield* operation
            if ((yield* workspaces.countActiveBindings(workspace.id)) === 0)
              yield* actions.stopWorkspaceServices(workspace.id)
            return { status: 'complete', value } as const
          }
          const retireLocal =
            intent === 'delete' &&
            workspace.kind === 'local' &&
            (yield* workspaces.countBindings(workspace.id, sessionId)) === 0
          if (retireLocal) yield* actions.stopWorkspaceRuns(workspace.id)
          if (
            !retireLocal &&
            (yield* workspaces.countActiveBindings(workspace.id, sessionId)) === 0
          )
            yield* actions.stopWorkspaceServices(workspace.id)
          const value = yield* intent === 'delete'
            ? operation.pipe(
                Effect.ensuring(
                  actions.cleanupDeletedWorkspaces.pipe(
                    Effect.catchAll((error) =>
                      Effect.sync(() => {
                        logger.warn('Deferred action history cleanup after Session deletion', {
                          sessionId,
                          error: error.message,
                        })
                      }),
                    ),
                  ),
                ),
              )
            : operation
          return { status: 'complete', value } as const
        }),
      )
      if (outcome.status === 'complete') return outcome.value
    }
  })
}
