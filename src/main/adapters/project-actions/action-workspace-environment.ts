import { matchBy } from '@diegogbrisa/ts-match'
import * as Effect from 'effect/Effect'
import type {
  WorkspaceDirectoryIdentity,
  WorkspaceGenerationCheck,
} from '../../domain/workspace-generation'
import { createLogger } from '../../logger'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'

const logger = createLogger('workspace-preparation')

type PreparationEnvironmentReader = Pick<
  WorkspacePreparationServiceShape,
  'read' | 'inspectWorkspaceGeneration' | 'environment'
>

type GenerationMismatch = Exclude<WorkspaceGenerationCheck, { readonly status: 'current' }>

const MISMATCH_PREFIX = 'This worktree no longer matches its saved preparation'

function describeIdentity(identity: WorkspaceDirectoryIdentity) {
  return `inode ${identity.inode}, created ${identity.birthtime}, device ${identity.device}`
}

export function workspaceGenerationMismatchMessage(check: GenerationMismatch) {
  return matchBy(check, 'status')
    .with(
      'replaced',
      ({ workspacePath, recorded, observed }) =>
        `${MISMATCH_PREFIX}: ${workspacePath} is a different folder from the one that was prepared (recorded ${describeIdentity(recorded)}; found ${describeIdentity(observed)}). Restore the original folder at that path, or hand this Session to another Workspace.`,
    )
    .with(
      'unreadable',
      ({ workspacePath, recorded }) =>
        `${MISMATCH_PREFIX}: ${workspacePath} is missing or is not a plain folder (recorded ${describeIdentity(recorded)}). Restore the worktree folder, or hand this Session to another Workspace.`,
    )
    .with(
      'unrecorded',
      ({ workspacePath }) =>
        `${MISMATCH_PREFIX}: no folder identity was recorded for ${workspacePath}. Hand this Session to another Workspace to continue.`,
    )
    .exhaustive()
}

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
        throw new Error(workspaceGenerationMismatchMessage(check))
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
