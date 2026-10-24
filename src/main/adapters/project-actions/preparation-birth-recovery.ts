import type { WorkspaceDirectoryIdentity } from '../../domain/workspace-generation'
import { createLogger } from '../../logger'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { PreparationDependencies } from './preparation-dependencies'
import type { StoredWorkspacePreparation } from './preparation-persistence'
import {
  inspectPreparationGeneration,
  isPendingPreparationBirth,
  readPreparationWorkspaceIdentity,
  unreadableWorktreeError,
  withRecordedBirth,
} from './preparation-workspace-generation'

const logger = createLogger('workspace-preparation')

/**
 * Filesystem birth times come from a coarser clock than `Date.now()` (a kernel tick on Linux,
 * about 15.6 ms on Windows), so a folder Git made just after the birth was prepared can carry a
 * slightly earlier time. A folder moved in from elsewhere is far older than this.
 */
export const BIRTH_CLOCK_TOLERANCE_MS = 1_000
const NANOSECONDS_PER_MILLISECOND = 1_000_000n

type BirthRecoveryRefusal =
  | 'setup-started'
  | 'birth-time-unrecorded'
  | 'missing-or-not-a-folder'
  | 'creation-time-unknown'
  | 'predates-birth'
  | 'not-a-linked-worktree'
  | 'worktree-add-unfinished'

type BirthRecovery =
  | { readonly record: WorkspaceDirectoryIdentity }
  | { readonly refusal: BirthRecoveryRefusal }

function decideFromFolder(
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

/** Git is asked last, and only about a folder that already passed the cheaper checks. */
async function decideBirthRecovery(
  workspace: ActionRunWorkspace,
  state: StoredWorkspacePreparation,
  inspectLinkedWorktree: PreparationDependencies['inspectLinkedWorktree'],
): Promise<BirthRecovery & { readonly observed: WorkspaceDirectoryIdentity | null }> {
  try {
    const observed = await readPreparationWorkspaceIdentity(workspace.workspacePath)
    const decision = decideFromFolder(state, observed)
    if ('refusal' in decision) return { ...decision, observed }
    const worktree = await inspectLinkedWorktree(workspace.projectPath, workspace.workspacePath)
    if (worktree === 'linked') return { ...decision, observed }
    return {
      refusal: worktree === 'locked' ? 'worktree-add-unfinished' : 'not-a-linked-worktree',
      observed,
    }
  } catch (error) {
    throw unreadableWorktreeError(workspace, error)
  }
}

/**
 * Records the folder of a pending birth that a run finds at the worktree path, as setup dispatch
 * would have, when the Host stopped between `git worktree add` and that capture. It records only
 * a readable folder created after the birth was prepared, with no setup run against it yet, that
 * Git reports as a finished linked worktree of the project. Anything else stays pending, and the
 * run keeps failing closed.
 */
async function recoverPreparationBirth(
  workspace: ActionRunWorkspace,
  existing: StoredWorkspacePreparation,
  deps: RunBirthDependencies,
) {
  const { workspaceId, workspacePath } = workspace
  if (!existing.awaitingWorktreeBirth || workspacePath === workspace.projectPath) return existing
  const { observed, ...decision } = await decideBirthRecovery(
    workspace,
    existing,
    deps.inspectLinkedWorktree,
  )
  const details = {
    workspaceId,
    workspacePath,
    awaitingWorktreeBirthSince: existing.awaitingWorktreeBirthSince,
    observed,
  }
  if ('refusal' in decision) {
    logger.warn('Did not record a pending worktree birth', { ...details, reason: decision.refusal })
    return existing
  }
  logger.info('Recorded a worktree created before its preparation captured it', details)
  return deps.save(withRecordedBirth(existing, decision.record), existing.revision)
}

export interface RunBirthDependencies {
  readonly save: (
    state: StoredWorkspacePreparation,
    previousRevision: number,
  ) => Promise<StoredWorkspacePreparation>
  readonly inspectLinkedWorktree: PreparationDependencies['inspectLinkedWorktree']
}

/** `recoverPreparationBirth`, then the generation check the run continues or fails on. */
export async function completeRunWorktreeBirth(
  workspace: ActionRunWorkspace,
  existing: StoredWorkspacePreparation | null,
  deps: RunBirthDependencies,
) {
  const state = existing && (await recoverPreparationBirth(workspace, existing, deps))
  return inspectPreparationGeneration(workspace, state)
}
