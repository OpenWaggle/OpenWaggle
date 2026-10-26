import type { PreparationPhase } from '@shared/types/workspace-preparation'
import { createLogger } from '../../logger'
import type { PreparationPersistence, StoredWorkspacePreparation } from './preparation-persistence'

const logger = createLogger('workspace-preparation')

function interruptRunningPhases(state: StoredWorkspacePreparation): StoredWorkspacePreparation {
  if (state.setup.status !== 'running' && state.cleanup.status !== 'running') return state
  const interrupt = (phase: PreparationPhase) =>
    state[phase].status === 'running'
      ? {
          ...state[phase],
          status: 'failed' as const,
          finishedAt: Date.now(),
          error:
            'The owning Host stopped during preparation. Retry explicitly after checking retained output.',
        }
      : state[phase]
  return { ...state, setup: interrupt('setup'), cleanup: interrupt('cleanup') }
}

/**
 * Older builds wrote `awaitingWorktreeBirth: true` for every local Workspace preparation
 * (issue #353). A local Workspace never has a worktree birth, so the flag only misled.
 */
function clearLocalBirthFlag(
  state: StoredWorkspacePreparation,
  localWorkspaceIds: ReadonlySet<string>,
): StoredWorkspacePreparation {
  if (state.awaitingWorktreeBirth === undefined || !localWorkspaceIds.has(state.workspaceId))
    return state
  const { awaitingWorktreeBirth: _pending, awaitingWorktreeBirthSince: _since, ...cleared } = state
  return cleared
}

async function readLocalWorkspaceIds(
  listLocalWorkspaceIds: (() => Promise<ReadonlySet<string>>) | undefined,
) {
  if (!listLocalWorkspaceIds) return new Set<string>()
  try {
    return await listLocalWorkspaceIds()
  } catch (error) {
    // Only a cleanup of an inert flag; the next Host start tries again.
    logger.warn('Could not list local Workspaces to clear stale worktree-birth flags', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new Set<string>()
  }
}

export async function recoverPreparationAfterHostLoss(
  persistence: PreparationPersistence,
  listLocalWorkspaceIds?: () => Promise<ReadonlySet<string>>,
) {
  const localWorkspaceIds = await readLocalWorkspaceIds(listLocalWorkspaceIds)
  for (const state of await persistence.list()) {
    const next = clearLocalBirthFlag(interruptRunningPhases(state), localWorkspaceIds)
    if (next === state) continue
    await persistence.write({ ...next, revision: state.revision + 1 }, state.revision)
  }
}
