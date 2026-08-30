import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionProjectionRepositoryError } from '../errors'
import { createLogger } from '../logger'
import type { SessionProjectionRepositoryShape } from '../ports/session-projection-repository'
import type { pruneSessionWorktree } from '../services/git/session-worktree-prune'
import type {
  abandonSessionDeletion,
  clearSessionWorktree,
  commitSessionDeletion,
  getBoundWorkspaceResource,
  getSessionDeletion,
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
import type { SessionDeletionRecord } from '../store/session-details/session-deletion-journal'
import type { CheckpointRefSnapshot } from './git/turn-checkpoint-refs'

interface SessionDeletionStore {
  readonly abandonSessionDeletion: typeof abandonSessionDeletion
  readonly clearSessionWorktree: typeof clearSessionWorktree
  readonly commitSessionDeletion: typeof commitSessionDeletion
  readonly getBoundWorkspaceResource: typeof getBoundWorkspaceResource
  readonly getSessionDeletion: typeof getSessionDeletion
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
  deletion: SessionDeletionRecord,
  id: SessionId,
  reason: 'delete' | 'archive',
  allowMissingWorktree = false,
  validateOnly = false,
) {
  return input.pruneSessionWorktree(
    {
      sessionId: String(id),
      projectPath: deletion.worktreeProjectPath ?? deletion.projectPath,
      worktreePath: deletion.worktreePath,
      reason,
      allowMissingWorktree,
      allowMissingWorkspaceReference: allowMissingWorktree,
      validateOnly,
    },
    {
      listWorktreeRefs: () => input.store.listSessionWorktreeRefs(),
      clearWorktree: (sessionId) => input.store.clearSessionWorktree(SessionId(sessionId)),
    },
  )
}

async function commitPreparedSessionDeletion(
  input: DeletionDependencies,
  deletion: SessionDeletionRecord,
  id: SessionId,
) {
  try {
    const pruning = await pruneWorktreeForSession(input, deletion, id, 'delete', false, true)
    if (pruning.status === 'retained') {
      throw new Error(`Session deletion was refused to preserve its Workspace (${pruning.reason}).`)
    }
    return await input.store.commitSessionDeletion(id)
  } catch (error) {
    await input.store.abandonSessionDeletion(id)
    throw error
  }
}

async function deleteSessionDurably(input: DeletionDependencies, id: SessionId) {
  const session = await input.store.getSessionDetail(id)
  let deletion = session
    ? await input.store.prepareSessionDeletion(id)
    : await input.store.getSessionDeletion(id)
  if (!deletion) return
  if (deletion.phase === 'pi-file-cleanup-complete') {
    await input.store.abandonSessionDeletion(id)
    return
  }
  if (deletion.phase === 'prepared') {
    deletion = await commitPreparedSessionDeletion(input, deletion, id)
  }
  if (deletion.phase === 'durable-delete-complete') {
    const removedRefs = deletion.projectPath
      ? await input.deleteCheckpointRefs(deletion.projectPath, String(id), (refs) =>
          input.store.prepareSessionCheckpointRefCleanup(id, refs),
        )
      : []
    deletion = { ...deletion, phase: 'checkpoint-ref-cleanup-pending', checkpointRefs: removedRefs }
  }
  if (deletion.phase === 'checkpoint-ref-cleanup-pending') {
    let removed = false
    try {
      if (deletion.projectPath) {
        await input.deleteCheckpointRefs(deletion.projectPath, String(id))
        removed = true
      }
      const pruning = await pruneWorktreeForSession(input, deletion, id, 'delete', true)
      if (pruning.status === 'retained') {
        throw new Error(`Session cleanup could not remove its Workspace (${pruning.reason}).`)
      }
    } catch (error) {
      if (deletion.projectPath && removed) {
        await input.restoreCheckpointRefs(deletion.projectPath, deletion.checkpointRefs)
      }
      throw error
    }
    await input.store.markSessionDeletionExternalCleanupComplete(id)
  }
  const cleanup =
    deletion.phase === 'pi-file-cleanup-pending'
      ? deletion
      : await input.store.prepareSessionPiFileCleanup(id, deletion.piSessionFile)
  await completeJournaledSessionFileDeletion(cleanup.piSessionFile, cleanup.stagedPiSessionFile)
  await input.store.markSessionPiFileCleanupComplete(id)
  await input.store.abandonSessionDeletion(id)
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

export async function archiveSessionWorkspace(input: DeletionDependencies, id: SessionId) {
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
      reason: 'archive',
    },
    {
      listWorktreeRefs: () => input.store.listSessionWorktreeRefs(),
      clearWorktree: (sessionId) => input.store.clearSessionWorktree(SessionId(sessionId)),
    },
  )
}
