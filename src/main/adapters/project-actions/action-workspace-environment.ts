import * as Effect from 'effect/Effect'
import { describeWorkspaceGenerationMismatch } from '../../domain/workspace-generation'
import { createLogger } from '../../logger'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'

const logger = createLogger('workspace-preparation')

type PreparationEnvironmentReader = Pick<
  WorkspacePreparationServiceShape,
  'read' | 'inspectWorkspaceGeneration' | 'environment'
>

export async function readPreparedWorkspaceEnvironment(
  preparation: PreparationEnvironmentReader,
  workspace: ActionRunWorkspace,
) {
  if (workspace.workspacePath !== workspace.projectPath) {
    const state = await Effect.runPromise(preparation.read(workspace))
    if (state) {
      const check = await Effect.runPromise(preparation.inspectWorkspaceGeneration(workspace))
      if (check.status !== 'current') {
        logger.warn('Worktree does not match its saved preparation', {
          workspaceId: workspace.workspaceId,
          ...check,
        })
        const { verdict, problem, recovery } = describeWorkspaceGenerationMismatch(check)
        throw new Error(`This worktree ${verdict} its saved preparation: ${problem}. ${recovery}`)
      }
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
