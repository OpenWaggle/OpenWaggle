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

/** A new preparation with nothing run yet, tied to the folder at the path or to a pending birth. */
export async function freshPreparationState(
  workspace: ActionRunWorkspace,
  snapshot: StoredWorkspacePreparation['snapshot'],
  revision: number,
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
  }
}

function withRecordedBirth(
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

/**
 * Filesystem birth times come from a coarser clock than `Date.now()` (a kernel tick on Linux,
 * about 15.6 ms on Windows), so a folder Git made just after the birth was prepared can carry a
 * slightly earlier time. A folder moved in from elsewhere is far older than this.
 */
const BIRTH_CLOCK_TOLERANCE_MS = 1_000
const NANOSECONDS_PER_MILLISECOND = 1_000_000n

type BirthRecoveryRefusal =
  | 'setup-started'
  | 'birth-time-unrecorded'
  | 'missing-or-not-a-folder'
  | 'creation-time-unknown'
  | 'predates-birth'

type BirthRecovery =
  | { readonly record: WorkspaceDirectoryIdentity }
  | { readonly refusal: BirthRecoveryRefusal }

function decideBirthRecovery(
  state: StoredWorkspacePreparation,
  identity: WorkspaceDirectoryIdentity | null,
): BirthRecovery {
  if (!isPendingPreparationBirth(state)) return { refusal: 'setup-started' }
  const since = state.awaitingWorktreeBirthSince
  if (since === undefined) return { refusal: 'birth-time-unrecorded' }
  if (!identity) return { refusal: 'missing-or-not-a-folder' }
  if (!/^\d+$/.test(identity.birthtime) || identity.birthtime === '0')
    return { refusal: 'creation-time-unknown' }
  const earliest =
    BigInt(Math.max(0, since - BIRTH_CLOCK_TOLERANCE_MS)) * NANOSECONDS_PER_MILLISECOND
  return BigInt(identity.birthtime) >= earliest
    ? { record: identity }
    : { refusal: 'predates-birth' }
}

/**
 * Records the folder of a pending birth that a run finds at the worktree path, as setup dispatch
 * would have, when the Host stopped between `git worktree add` and that capture. Only a readable
 * folder created after the birth was prepared, with no setup run against it yet, is recorded;
 * anything else stays pending, and the run keeps failing closed.
 */
async function recoverPreparationBirth(
  workspace: ActionRunWorkspace,
  existing: StoredWorkspacePreparation,
  save: (
    state: StoredWorkspacePreparation,
    previousRevision: number,
  ) => Promise<StoredWorkspacePreparation>,
) {
  const { workspaceId, workspacePath } = workspace
  if (!existing.awaitingWorktreeBirth || workspacePath === workspace.projectPath) return existing
  let identity: WorkspaceDirectoryIdentity | null
  try {
    identity = await readPreparationWorkspaceIdentity(workspacePath)
  } catch (error) {
    throw unreadableWorktreeError(workspace, error)
  }
  const decision = decideBirthRecovery(existing, identity)
  if ('refusal' in decision) {
    logger.warn('Did not record a pending worktree birth', {
      workspaceId,
      workspacePath,
      reason: decision.refusal,
      awaitingWorktreeBirthSince: existing.awaitingWorktreeBirthSince,
      observed: identity,
    })
    return existing
  }
  logger.info('Recorded a worktree created before its preparation captured it', {
    workspaceId,
    workspacePath,
    awaitingWorktreeBirthSince: existing.awaitingWorktreeBirthSince,
    observed: decision.record,
  })
  return save(withRecordedBirth(existing, decision.record), existing.revision)
}

/** `recoverPreparationBirth`, then the generation check the run continues or fails on. */
export async function completeRunWorktreeBirth(
  workspace: ActionRunWorkspace,
  existing: StoredWorkspacePreparation | null,
  save: (
    state: StoredWorkspacePreparation,
    previousRevision: number,
  ) => Promise<StoredWorkspacePreparation>,
) {
  const state = existing && (await recoverPreparationBirth(workspace, existing, save))
  return inspectPreparationGeneration(workspace, state)
}

/** A permission or I/O error reading the worktree, logged and named with its path. */
function unreadableWorktreeError(workspace: ActionRunWorkspace, error: unknown) {
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
