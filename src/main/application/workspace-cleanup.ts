import type { GitWorktreeMutationResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { ActionRunService, type ActionRunWorkspace } from '../ports/action-run-service'
import { WorkspacePreparationService } from '../ports/workspace-preparation-service'

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
    if (!(yield* preparation.isCurrentWorkspaceGeneration(workspace))) {
      if (options.skipCleanup) {
        yield* preparation.skip(workspace, 'cleanup', state.revision)
        return null
      }
      return {
        ok: false,
        code: 'cleanup-failed',
        preparation: state,
        message:
          'This worktree no longer matches the checkout that captured its preparation. Its pinned cleanup cannot run here. Choose Delete anyway to remove this checkout without running that cleanup.',
      } satisfies GitWorktreeMutationResult
    }
    const blocked = state.cleanup.status === 'failed' || state.cleanup.status === 'review-required'
    if (options.skipCleanup && blocked) {
      yield* preparation.skip(workspace, 'cleanup', state.revision)
      return null
    }
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
