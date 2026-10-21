import { stat } from 'node:fs/promises'
import { isEnoent } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { describeWorkspaceGenerationMismatch } from '../domain/workspace-generation'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'
import { WorkspacePreparationService } from '../ports/workspace-preparation-service'

function retainedMismatchMessage({
  verdict,
  problem,
}: ReturnType<typeof describeWorkspaceGenerationMismatch>) {
  return `This checkout ${verdict} the one that captured its cleanup: ${problem}. Cleanup cannot run here; choose Delete anyway to remove this checkout.`
}

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
                if (isEnoent(error)) return false
                throw error
              }
            },
            catch: (cause) => new Error('Could not inspect retained worktree.', { cause }),
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
                  generationMismatchMessage: retainedMismatchMessage(
                    describeWorkspaceGenerationMismatch(generation),
                  ),
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
