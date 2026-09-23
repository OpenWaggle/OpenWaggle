import { realpath } from 'node:fs/promises'
import { isEnoent, isNodeError } from '@shared/utils/node-error'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import { readActionWorkspaceIdentity } from './action-manifest-file'
import type { StoredWorkspacePreparation } from './preparation-persistence'
import { EMPTY_PREPARATION_EXECUTION } from './workspace-preparation-model'

export function resetPreparationForBirth(
  state: StoredWorkspacePreparation,
): StoredWorkspacePreparation {
  return {
    workspaceId: state.workspaceId,
    revision: state.revision + 1,
    snapshot: state.snapshot,
    setup: EMPTY_PREPARATION_EXECUTION,
    cleanup: EMPTY_PREPARATION_EXECUTION,
    environment: {},
    awaitingWorktreeBirth: true,
  }
}

export function isPendingPreparationBirth(state: StoredWorkspacePreparation) {
  return (
    state.awaitingWorktreeBirth === true &&
    state.setup.status === 'idle' &&
    state.cleanup.status === 'idle'
  )
}

async function readPreparationWorkspaceIdentity(workspacePath: string) {
  try {
    return await readActionWorkspaceIdentity(await realpath(workspacePath))
  } catch (error) {
    if (isEnoent(error) || isNodeError(error, 'ENOTDIR') || isNodeError(error, 'ELOOP')) return null
    throw error
  }
}

export async function preparationGenerationFields(workspace: ActionRunWorkspace) {
  const identity =
    workspace.workspacePath === workspace.projectPath
      ? null
      : await readPreparationWorkspaceIdentity(workspace.workspacePath)
  return identity ? { workspaceIdentity: identity } : { awaitingWorktreeBirth: true }
}

export async function completePreparationBirth(
  workspace: ActionRunWorkspace,
  existing: StoredWorkspacePreparation,
  save: (
    state: StoredWorkspacePreparation,
    previousRevision: number,
  ) => Promise<StoredWorkspacePreparation>,
) {
  if (!existing.awaitingWorktreeBirth || workspace.workspacePath === workspace.projectPath)
    return existing
  const identity = await readPreparationWorkspaceIdentity(workspace.workspacePath)
  if (!identity) return existing
  return save(
    {
      ...existing,
      revision: existing.revision + 1,
      workspaceIdentity: identity,
      awaitingWorktreeBirth: false,
    },
    existing.revision,
  )
}

export async function isCurrentPreparationGeneration(
  workspace: ActionRunWorkspace,
  state: StoredWorkspacePreparation | null,
) {
  const recorded = state?.workspaceIdentity
  if (!recorded) return false
  const current = await readPreparationWorkspaceIdentity(workspace.workspacePath)
  return (
    current?.device === recorded.device &&
    current.inode === recorded.inode &&
    current.birthtime === recorded.birthtime
  )
}
