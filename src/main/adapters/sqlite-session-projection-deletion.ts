import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionProjectionRepositoryError } from '../errors'
import { createLogger } from '../logger'
import type { SessionProjectionRepositoryShape } from '../ports/session-projection-repository'
import type { pruneSessionWorktree } from '../services/git/session-worktree-prune'
import type {
  abandonSessionDeletion,
  clearSessionWorktree,
  deleteSession,
  getBoundWorkspaceResource,
  getSessionDetail,
  listPendingSessionDeletions,
  listSessionWorktreeRefs,
  markSessionDeletionExternalCleanupComplete,
  markSessionPiFileCleanupComplete,
  prepareSessionCheckpointRefCleanup,
  prepareSessionDeletion,
  prepareSessionPiFileCleanup,
} from '../store/session-details'
import { completeJournaledSessionFileDeletion } from '../store/session-details/file-deletion'
import type { CheckpointRefSnapshot } from './git/turn-checkpoint-refs'

interface SessionDeletionStore {
  readonly abandonSessionDeletion: typeof abandonSessionDeletion
  readonly clearSessionWorktree: typeof clearSessionWorktree
  readonly deleteSession: typeof deleteSession
  readonly getBoundWorkspaceResource: typeof getBoundWorkspaceResource
  readonly getSessionDetail: typeof getSessionDetail
  readonly listPendingSessionDeletions: typeof listPendingSessionDeletions
  readonly listSessionWorktreeRefs: typeof listSessionWorktreeRefs
  readonly markSessionDeletionExternalCleanupComplete: typeof markSessionDeletionExternalCleanupComplete
  readonly markSessionPiFileCleanupComplete: typeof markSessionPiFileCleanupComplete
  readonly prepareSessionDeletion: typeof prepareSessionDeletion
  readonly prepareSessionCheckpointRefCleanup: typeof prepareSessionCheckpointRefCleanup
  readonly prepareSessionPiFileCleanup: typeof prepareSessionPiFileCleanup
}

const logger = createLogger('sqlite-session-projection/deletion')

interface DeletionDependencies {
  readonly store: SessionDeletionStore
  readonly pruneSessionWorktree: typeof pruneSessionWorktree
  readonly deleteCheckpointRefs: (
    projectPath: string,
    sessionId: string,
    beforeDelete?: (refs: readonly CheckpointRefSnapshot[]) => Promise<void>,
  ) => Promise<readonly CheckpointRefSnapshot[]>
  readonly restoreCheckpointRefs: (
    projectPath: string,
    refs: readonly CheckpointRefSnapshot[],
  ) => Promise<void>
}

async function pruneWorktreeForSession(
  input: DeletionDependencies,
  id: SessionId,
  reason: 'delete' | 'archive',
  allowMissingWorktree = false,
) {
  const session = await input.store.getSessionDetail(id)
  if (!session) return { status: 'ready-for-deletion' } as const
  const workspace = await input.store.getBoundWorkspaceResource(id)
  return input.pruneSessionWorktree(
    {
      sessionId: String(id),
      projectPath: workspace?.projectPath ?? session.projectPath,
      worktreePath:
        workspace?.kind === 'managed-worktree'
          ? workspace.workingPath
          : (session.worktreePath ?? null),
      reason,
      allowMissingWorktree,
    },
    {
      listWorktreeRefs: () => input.store.listSessionWorktreeRefs(),
      clearWorktree: (sessionId) => input.store.clearSessionWorktree(SessionId(sessionId)),
    },
  )
}

async function restoreAfterCleanupFailure(
  input: DeletionDependencies,
  sessionId: SessionId,
  projectPath: string | null,
  removedRefs: readonly CheckpointRefSnapshot[],
  error: unknown,
) {
  try {
    if (projectPath) await input.restoreCheckpointRefs(projectPath, removedRefs)
    await input.store.abandonSessionDeletion(sessionId)
  } catch (restoreError) {
    logger.error('Failed to compensate a refused Session deletion.', {
      error: String(error),
      restoreError: String(restoreError),
      sessionId: String(sessionId),
    })
    throw new AggregateError(
      [error, restoreError],
      'Session deletion and checkpoint-ref compensation both failed.',
      { cause: restoreError },
    )
  }
}

async function deleteSessionDurably(input: DeletionDependencies, id: SessionId) {
  const session = await input.store.getSessionDetail(id)
  if (!session) return
  const deletion = await input.store.prepareSessionDeletion(id)
  if (deletion.phase === 'pi-file-cleanup-complete') {
    await input.store.deleteSession(id)
    return
  }
  if (deletion.phase === 'prepared') {
    let removedRefs: readonly CheckpointRefSnapshot[] = []
    try {
      removedRefs = session.projectPath
        ? await input.deleteCheckpointRefs(session.projectPath, String(id), (refs) =>
            input.store.prepareSessionCheckpointRefCleanup(id, refs),
          )
        : []
      const pruning = await pruneWorktreeForSession(input, id, 'delete', deletion.resumed)
      if (pruning.status === 'retained') {
        throw new Error(
          `Session deletion was refused to preserve its Workspace (${pruning.reason}).`,
        )
      }
    } catch (error) {
      await restoreAfterCleanupFailure(input, id, session.projectPath, removedRefs, error)
      throw error
    }
    await input.store.markSessionDeletionExternalCleanupComplete(id)
  }
  if (deletion.phase === 'checkpoint-ref-cleanup-pending') {
    let removed = false
    try {
      if (session.projectPath) {
        await input.deleteCheckpointRefs(session.projectPath, String(id))
        removed = true
      }
      const pruning = await pruneWorktreeForSession(input, id, 'delete', true)
      if (pruning.status === 'retained') {
        throw new Error(
          `Session deletion was refused to preserve its Workspace (${pruning.reason}).`,
        )
      }
    } catch (error) {
      await restoreAfterCleanupFailure(
        input,
        id,
        session.projectPath,
        removed ? deletion.checkpointRefs : [],
        error,
      )
      throw error
    }
    await input.store.markSessionDeletionExternalCleanupComplete(id)
  }
  const cleanup = await input.store.prepareSessionPiFileCleanup(id, session.piSessionFile ?? null)
  await completeJournaledSessionFileDeletion(cleanup.piSessionFile, cleanup.stagedPiSessionFile)
  await input.store.markSessionPiFileCleanupComplete(id)
  await input.store.deleteSession(id)
}

function recoverPendingDeletions(input: DeletionDependencies) {
  return Effect.promise(async () => {
    for (const id of await input.store.listPendingSessionDeletions()) {
      try {
        await deleteSessionDurably(input, id)
      } catch (error) {
        logger.error('Pending Session deletion recovery failed; Session remains visible.', {
          error: String(error),
          sessionId: String(id),
        })
      }
    }
  })
}

export function createSessionProjectionDeletionMethods(
  input: DeletionDependencies,
): Pick<SessionProjectionRepositoryShape, 'delete' | 'recoverPendingDeletions'> {
  return {
    delete: (id) =>
      Effect.tryPromise({
        try: () => deleteSessionDurably(input, id),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'delete', cause }),
      }),
    recoverPendingDeletions: () => recoverPendingDeletions(input),
  }
}

export function archiveSessionWorkspace(input: DeletionDependencies, id: SessionId) {
  return pruneWorktreeForSession(input, id, 'archive')
}
