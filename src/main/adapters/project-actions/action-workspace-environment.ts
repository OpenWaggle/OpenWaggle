import * as Effect from 'effect/Effect'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'

type PreparationEnvironmentReader = Pick<
  WorkspacePreparationServiceShape,
  'read' | 'isCurrentWorkspaceGeneration' | 'environment'
>

export async function readActionWorkspaceEnvironment(
  preparation: PreparationEnvironmentReader,
  workspace: ActionRunWorkspace,
) {
  if (workspace.workspacePath !== workspace.projectPath) {
    const state = await Effect.runPromise(preparation.read(workspace))
    if (state && !(await Effect.runPromise(preparation.isCurrentWorkspaceGeneration(workspace)))) {
      throw new Error(
        'This worktree no longer matches its saved preparation. Recreate the worktree or reset preparation before running actions.',
      )
    }
  }
  return {
    ...(await Effect.runPromise(preparation.environment(workspace.workspaceId))),
    OPENWAGGLE_PROJECT_ROOT: workspace.projectPath,
    OPENWAGGLE_WORKTREE_PATH: workspace.workspacePath,
  }
}
