import { lstat, realpath } from 'node:fs/promises'
import { worktreePreparationHeadline } from '@shared/domain/worktree-preparation-messages'
import { isEnoent, isNodeError } from '@shared/utils/node-error'
import {
  isSameDurableDirectoryIdentity,
  type WorkspaceDirectoryIdentity,
  type WorkspaceGenerationCheck,
} from '../../domain/workspace-generation'
import { createLogger } from '../../logger'
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
    awaitingWorktreeBirthSince: Date.now(),
  }
}

/**
 * A birth prepared again, for a retry or over a pending birth saved before the time was recorded:
 * only a folder made after this attempt may be recorded for it.
 */
export function refreshPendingBirth(state: StoredWorkspacePreparation): StoredWorkspacePreparation {
  return { ...state, revision: state.revision + 1, awaitingWorktreeBirthSince: Date.now() }
}

/** Setup is still owed for a birth a run recorded (`runBirthSetupOwed`). */
export function owesRunBirthSetup(state: StoredWorkspacePreparation | null) {
  return (
    state?.runBirthSetupOwed === true &&
    state.setup.status !== 'succeeded' &&
    state.setup.status !== 'skipped'
  )
}

/** Drops `runBirthSetupOwed` once setup has succeeded or been skipped. */
export function settleRunBirthSetup(state: StoredWorkspacePreparation): StoredWorkspacePreparation {
  if (!state.runBirthSetupOwed || owesRunBirthSetup(state)) return state
  const { runBirthSetupOwed: _settled, ...settled } = state
  return settled
}

export function isPendingPreparationBirth(state: StoredWorkspacePreparation) {
  return (
    state.awaitingWorktreeBirth === true &&
    state.setup.status === 'idle' &&
    state.cleanup.status === 'idle'
  )
}

export async function readPreparationWorkspaceIdentity(workspacePath: string) {
  try {
    return await readActionWorkspaceIdentity(await realpath(workspacePath))
  } catch (error) {
    if (isEnoent(error) || isNodeError(error, 'ENOTDIR') || isNodeError(error, 'ELOOP')) return null
    throw error
  }
}

/** A new preparation with nothing run yet, tied to the folder at the path or to a pending birth. */
export async function freshPreparationState(
  workspace: ActionRunWorkspace,
  snapshot: StoredWorkspacePreparation['snapshot'],
  revision: number,
  previous: StoredWorkspacePreparation | null = null,
): Promise<StoredWorkspacePreparation> {
  const identity =
    workspace.workspacePath === workspace.projectPath
      ? null
      : await readPreparationWorkspaceIdentity(workspace.workspacePath)
  return {
    workspaceId: workspace.workspaceId,
    revision,
    snapshot,
    setup: EMPTY_PREPARATION_EXECUTION,
    cleanup: EMPTY_PREPARATION_EXECUTION,
    environment: {},
    ...(identity
      ? { workspaceIdentity: identity }
      : { awaitingWorktreeBirth: true, awaitingWorktreeBirthSince: Date.now() }),
    // Choosing another profile for the same folder keeps the setup a run's birth still owes.
    ...(identity && owesRunBirthSetup(previous) ? { runBirthSetupOwed: true as const } : {}),
  }
}

export function withRecordedBirth(
  existing: StoredWorkspacePreparation,
  identity: WorkspaceDirectoryIdentity,
): StoredWorkspacePreparation {
  const { awaitingWorktreeBirthSince: _since, ...state } = existing
  return {
    ...state,
    revision: existing.revision + 1,
    workspaceIdentity: identity,
    awaitingWorktreeBirth: false,
  }
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
  return save(withRecordedBirth(existing, identity), existing.revision)
}

const logger = createLogger('workspace-preparation')

/** A permission or I/O error reading the worktree, logged and named with its path. */
export function unreadableWorktreeError(workspace: ActionRunWorkspace, error: unknown) {
  const { workspacePath } = workspace
  const reason = error instanceof Error ? error.message : String(error)
  logger.warn('Could not check the worktree against its saved preparation', {
    workspaceId: workspace.workspaceId,
    workspacePath,
    error: reason,
  })
  // The shared headline keeps the chat card from reading the path as another kind of error.
  return new Error(
    `${worktreePreparationHeadline('cannot be checked against')}: ${workspacePath} could not be read (${reason}). Check that you can open this folder and the folders above it, then try again.`,
    { cause: error },
  )
}

/**
 * Whether anything is at the path. A looping link or a file on the way there counts as
 * something: Recreate worktree cannot create a folder under either until it is removed.
 */
async function pathExists(workspacePath: string) {
  try {
    await lstat(workspacePath)
    return true
  } catch (error) {
    if (isNodeError(error, 'ELOOP') || isNodeError(error, 'ENOTDIR')) return true
    if (isEnoent(error)) return false
    throw error
  }
}

async function observeGeneration(
  workspacePath: string,
  recorded: WorkspaceDirectoryIdentity,
): Promise<WorkspaceGenerationCheck> {
  const observed = await readPreparationWorkspaceIdentity(workspacePath)
  if (!observed) {
    const reason = (await pathExists(workspacePath)) ? 'not-a-folder' : 'missing'
    return { status: 'unreadable', workspacePath, reason, recorded }
  }
  return isSameDurableDirectoryIdentity(observed, recorded)
    ? { status: 'current' }
    : { status: 'replaced', workspacePath, recorded, observed }
}

/**
 * Runs, worktree removal and the retained-preparation list all check here. A missing or replaced
 * folder is a result; a permission or I/O error reading it is thrown with the worktree path.
 */
export async function inspectPreparationGeneration(
  workspace: ActionRunWorkspace,
  state: StoredWorkspacePreparation | null,
): Promise<WorkspaceGenerationCheck> {
  const { workspacePath } = workspace
  const recorded = state?.workspaceIdentity
  if (!recorded)
    return state?.awaitingWorktreeBirth
      ? { status: 'awaiting-birth', workspacePath }
      : { status: 'unrecorded', workspacePath }
  try {
    return await observeGeneration(workspacePath, recorded)
  } catch (error) {
    throw unreadableWorktreeError(workspace, error)
  }
}
