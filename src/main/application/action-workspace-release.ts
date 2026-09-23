import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { createLogger } from '../logger'
import { ActionRunService } from '../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'

const logger = createLogger('action-workspace-release')
const SERVICE_RELEASE_RETRY_MS = 1_000
const SERVICE_RELEASE_BACKOFF_MULTIPLIER = 2
const SERVICE_RELEASE_MAX_RETRY_MS = 30_000

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
      const stopServicesIfUnbound = Effect.gen(function* () {
        if ((yield* workspaces.countActiveBindings(workspace.id)) === 0)
          yield* actions.stopWorkspaceServices(workspace.id)
      })
      const cleanupDeleted = Effect.suspend(() => actions.cleanupDeletedWorkspaces).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.warn('Deferred action history cleanup after Session deletion', {
              sessionId,
              error: error.message,
            })
          }),
        ),
      )
      const releaseServicesAfter = Effect.gen(function* () {
        const release = yield* stopServicesIfUnbound.pipe(Effect.either)
        if (release._tag === 'Left') {
          logger.warn('Committed Workspace release; retrying action service shutdown', {
            workspaceId: workspace.id,
            error: release.left.message,
          })
          yield* Effect.forkDaemon(
            Effect.gen(function* () {
              let retryDelay = SERVICE_RELEASE_RETRY_MS
              while (true) {
                yield* Effect.sleep(retryDelay)
                const retry = yield* actions
                  .withWorkspaceMutation(workspace.id, stopServicesIfUnbound)
                  .pipe(Effect.either)
                if (retry._tag === 'Right') return
                retryDelay = Math.min(
                  retryDelay * SERVICE_RELEASE_BACKOFF_MULTIPLIER,
                  SERVICE_RELEASE_MAX_RETRY_MS,
                )
              }
            }),
          )
        }
      })
      const outcome = yield* actions.withWorkspaceMutation(
        workspace.id,
        Effect.gen(function* () {
          // A preceding handoff can replace the binding while this caller waits for admission.
          if ((yield* workspaces.getBound(sessionId))?.id !== workspace.id)
            return { status: 'retry' } as const
          // Managed deletion validates the worktree before its admitted removal stops services.
          // Stopping here first would kill a live service even when Git refuses a dirty checkout.
          if (timing === 'after' || intent === 'archive') {
            return yield* Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const value = yield* restore(operation)
                yield* releaseServicesAfter
                return { status: 'complete', value } as const
              }),
            )
          }
          if (intent === 'delete' && workspace.kind === 'managed-worktree') {
            // Git validation can refuse deletion. Inspect the committed binding after the
            // operation so a refused deletion leaves the still-bound services running.
            return yield* Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const result = yield* restore(operation).pipe(Effect.exit)
                yield* releaseServicesAfter
                yield* cleanupDeleted
                if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause)
                return { status: 'complete', value: result.value } as const
              }),
            )
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
            ? operation.pipe(Effect.ensuring(cleanupDeleted))
            : operation
          return { status: 'complete', value } as const
        }),
      )
      if (outcome.status === 'complete') return outcome.value
    }
  })
}
