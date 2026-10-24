import type { GitWorktreeMutationResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import {
  describeCleanupBlockedByGeneration,
  preparationPinsCleanup,
} from '../domain/workspace-generation'
import { createLogger } from '../logger'
import { ActionRunService, type ActionRunWorkspace } from '../ports/action-run-service'
import { WorkspacePreparationService } from '../ports/workspace-preparation-service'

const logger = createLogger('workspace-preparation')

/** Caller owns the Workspace mutation fence and a durable, unbound removal reservation. */
export function prepareWorkspaceRemoval(
  workspace: ActionRunWorkspace,
  options: { readonly skipCleanup?: boolean; readonly retryFailed: boolean },
) {
  return Effect.gen(function* () {
    const actions = yield* ActionRunService
    const preparation = yield* WorkspacePreparationService
    yield* actions.stopWorkspaceRuns(workspace.workspaceId)
    const state = yield* preparation.read(workspace)
    if (!state) return null
    // With no pinned cleanup there is nothing to run, or to protect from a replacement checkout.
    if (options.skipCleanup || !preparationPinsCleanup(state.snapshot)) {
      yield* preparation.skip(workspace, 'cleanup', state.revision)
      return null
    }
    const generation = yield* preparation.inspectWorkspaceGeneration(workspace)
    if (generation.status !== 'current') {
      logger.warn('Worktree cleanup refused: it failed its saved-preparation check', {
        workspaceId: workspace.workspaceId,
        ...generation,
      })
      return {
        ok: false,
        code: 'cleanup-failed',
        preparation: state,
        message: describeCleanupBlockedByGeneration(generation, state.snapshot),
      } satisfies GitWorktreeMutationResult
    }
    const blocked = state.cleanup.status === 'failed' || state.cleanup.status === 'review-required'
    const current =
      blocked && !options.retryFailed ? state : yield* preparation.run(workspace, 'cleanup')
    if (current.cleanup.status === 'succeeded' || current.cleanup.status === 'skipped') return null
    return {
      ok: false,
      code: 'cleanup-failed',
      preparation: current,
      message: `Workspace cleanup is ${current.cleanup.status}. ${current.cleanup.error ?? ''} The worktree was retained. Retry cleanup or explicitly choose Delete anyway.`,
    } satisfies GitWorktreeMutationResult
  })
}
