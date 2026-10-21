import { stat } from 'node:fs/promises'
import { isEnoent, isNodeError } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { describeCleanupBlockedByGeneration } from '../domain/workspace-generation'
import { createLogger } from '../logger'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'
import { WorkspacePreparationService } from '../ports/workspace-preparation-service'

const logger = createLogger('workspace-preparation')

/** Only the authorized project's recorded workspaces may contribute private cleanup state. */
export function listRetainedPreparation(projectPath: string) {
  return Effect.gen(function* () {
    const repository = yield* SessionWorkspaceResourceRepository
    const preparation = yield* WorkspacePreparationService
    const candidates = yield* repository.listManagedWorktreeRemovalCandidates()
    const results = yield* Effect.forEach(
      candidates.filter((workspace) => workspace.projectPath === projectPath),
      (workspace) =>
        Effect.gen(function* () {
          const exists = yield* Effect.tryPromise({
            try: async () => {
              try {
                return (await stat(workspace.workingPath)).isDirectory()
              } catch (error) {
                // Not a folder Git could remove, so there is no cleanup recovery to offer.
                if (isEnoent(error) || isNodeError(error, 'ENOTDIR') || isNodeError(error, 'ELOOP'))
                  return false
                throw error
              }
            },
            catch: (cause) => {
              const reason = cause instanceof Error ? cause.message : String(cause)
              logger.warn('Could not inspect a retained worktree', {
                workspaceId: workspace.id,
                workspacePath: workspace.workingPath,
                error: reason,
              })
              return new Error(`Could not inspect ${workspace.workingPath}: ${reason}`, { cause })
            },
          })
          if (!exists) return null
          const scope = {
            workspaceId: workspace.id,
            projectPath,
            workspacePath: workspace.workingPath,
          }
          const state = yield* preparation.read(scope)
          if (!state) return null
          const generation = yield* preparation.inspectWorkspaceGeneration(scope)
          const generationMismatch = generation.status !== 'current'
          if (
            !generationMismatch &&
            state.cleanup.status !== 'failed' &&
            state.cleanup.status !== 'review-required' &&
            state.cleanup.status !== 'succeeded' &&
            state.cleanup.status !== 'skipped'
          )
            return null
          return {
            path: workspace.workingPath,
            preparation: state,
            ...(generation.status === 'current'
              ? {}
              : {
                  generationMismatch: true,
                  generationMismatchMessage: describeCleanupBlockedByGeneration(generation),
                }),
          }
        }),
    )
    return {
      type: 'retained-preparation',
      workspaces: results.filter((state) => state !== null),
    } as const
  })
}
