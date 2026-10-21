import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import {
  describeWorkspaceGenerationMismatch,
  type WorkspaceGenerationCheck,
} from '../../domain/workspace-generation'
import { createLogger } from '../../logger'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'

const logger = createLogger('workspace-preparation')

type PreparationEnvironmentReader = Pick<
  WorkspacePreparationServiceShape,
  'read' | 'inspectWorkspaceGeneration' | 'environment'
>

async function inspectGeneration(
  preparation: PreparationEnvironmentReader,
  workspace: ActionRunWorkspace,
): Promise<WorkspaceGenerationCheck> {
  const result = await Effect.runPromise(
    Effect.either(preparation.inspectWorkspaceGeneration(workspace)),
  )
  if (Either.isRight(result)) return result.right
  // Missing folders are a check result; this is a permission or I/O failure reading one.
  const error = result.left
  logger.warn('Could not check the worktree against its saved preparation', {
    workspaceId: workspace.workspaceId,
    workspacePath: workspace.workspacePath,
    error: error.message,
  })
  throw new Error(
    `Could not check ${workspace.workspacePath} against its saved preparation: ${error.message}`,
    { cause: error },
  )
}

export async function readPreparedWorkspaceEnvironment(
  preparation: PreparationEnvironmentReader,
  workspace: ActionRunWorkspace,
) {
  if (workspace.workspacePath !== workspace.projectPath) {
    const state = await Effect.runPromise(preparation.read(workspace))
    if (state) {
      const check = await inspectGeneration(preparation, workspace)
      if (check.status !== 'current') {
        logger.warn('Worktree does not match its saved preparation', {
          workspaceId: workspace.workspaceId,
          ...check,
        })
        const { problem, recovery } = describeWorkspaceGenerationMismatch(check)
        throw new Error(
          `This worktree no longer matches its saved preparation: ${problem}. ${recovery}`,
        )
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
