import { worktreePreparationHeadline } from '@shared/domain/worktree-preparation-messages'
import * as Effect from 'effect/Effect'
import { describeWorkspaceGenerationMismatch } from '../../domain/workspace-generation'
import { createLogger } from '../../logger'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'

const logger = createLogger('workspace-preparation')

type PreparationEnvironmentReader = Pick<
  WorkspacePreparationServiceShape,
  'read' | 'inspectWorkspaceGeneration' | 'completeWorktreeBirth' | 'environment'
>

/**
 * A Host that stopped between `git worktree add` and the setup dispatch's capture leaves the
 * birth pending with the folder in place; the run records it then, when that is safe.
 */
async function inspectRunWorkspaceGeneration(
  preparation: PreparationEnvironmentReader,
  workspace: ActionRunWorkspace,
) {
  const check = await Effect.runPromise(preparation.inspectWorkspaceGeneration(workspace))
  if (check.status !== 'awaiting-birth') return { check, birthRecorded: false }
  const recovered = await Effect.runPromise(preparation.completeWorktreeBirth(workspace))
  return { check: recovered, birthRecorded: recovered.status === 'current' }
}

export interface PreparedWorkspaceEnvironmentOptions {
  /**
   * Runs after this run recorded a pending birth's folder and before the exports are read. Its
   * setup was never dispatched, so the agent run gates on it here.
   */
  readonly onBirthRecorded?: () => Promise<void>
}

export async function readPreparedWorkspaceEnvironment(
  preparation: PreparationEnvironmentReader,
  workspace: ActionRunWorkspace,
  options: PreparedWorkspaceEnvironmentOptions = {},
) {
  if (workspace.workspacePath !== workspace.projectPath) {
    const state = await Effect.runPromise(preparation.read(workspace))
    if (state) {
      const { check, birthRecorded } = await inspectRunWorkspaceGeneration(preparation, workspace)
      if (check.status !== 'current') {
        logger.warn('Worktree failed its saved-preparation check', {
          workspaceId: workspace.workspaceId,
          ...check,
        })
        const { verdict, problem, recovery, details } = describeWorkspaceGenerationMismatch(check)
        const message = `${worktreePreparationHeadline(verdict)}: ${problem}. ${recovery}`
        throw new Error(details ? `${message} ${details}` : message)
      }
      if (birthRecorded) await options.onBirthRecorded?.()
    }
  }
  return Effect.runPromise(preparation.environment(workspace.workspaceId))
}

export async function readActionWorkspaceEnvironment(
  preparation: PreparationEnvironmentReader,
  workspace: ActionRunWorkspace,
) {
  return {
    ...(await readPreparedWorkspaceEnvironment(preparation, workspace)),
    OPENWAGGLE_PROJECT_ROOT: workspace.projectPath,
    OPENWAGGLE_WORKTREE_PATH: workspace.workspacePath,
  }
}
