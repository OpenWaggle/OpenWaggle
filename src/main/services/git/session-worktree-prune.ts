import { deleteSessionTurnCheckpointRefs } from '../../adapters/git/turn-checkpoint-refs'
import { removeGitWorktree } from '../../adapters/git/worktree'
import { createLogger } from '../../logger'
import { getOrphanedWorktreePathForSession, type SessionWorktreeRef } from './worktree-cleanup'

const logger = createLogger('session-worktree-prune')

export interface PruneSessionWorktreeDeps {
  readonly listWorktreeRefs: () => Promise<readonly SessionWorktreeRef[]>
  readonly clearWorktree: (sessionId: string) => Promise<void>
  readonly deleteCheckpoints: (sessionId: string) => Promise<void>
}

/**
 * Death path for a Session worktree (ADR 0010): remove the worktree only when no
 * other session shares it (orphan guard), then clear the binding and prune Turn
 * checkpoints. Store access is injected so this stays within the git module's
 * boundary. Best-effort — relies on git's native dirty refusal and never throws.
 */
export async function pruneSessionWorktree(
  input: {
    readonly sessionId: string
    readonly projectPath: string | null
    readonly worktreePath: string | null
    /**
     * Why the session is being pruned.
     *
     * Archiving is reversible - `unarchive` exists and only flips a flag - so it must not destroy
     * anything that cannot come back. Turn checkpoints and their anchor refs were deleted for both
     * reasons, so an archived session returned with its whole turn-diff history gone and its snapshot
     * objects unpinned. Only a delete removes them.
     */
    readonly reason: 'delete' | 'archive'
  },
  deps: PruneSessionWorktreeDeps,
): Promise<void> {
  try {
    const worktreePath = input.worktreePath?.trim()
    if (!worktreePath || !input.projectPath) {
      await discardCheckpoints(input, deps)
      return
    }

    const refs = await deps.listWorktreeRefs()
    const orphaned = getOrphanedWorktreePathForSession(refs, input.sessionId)
    const removalFailed = orphaned ? await removalFailedFor(input.projectPath, orphaned) : false
    if (!removalFailed) {
      await deps.clearWorktree(input.sessionId)
    }

    await discardCheckpoints(input, deps)
  } catch (error) {
    logger.warn('Failed to prune Session worktree', { error: String(error) })
  }
}

/**
 * Drop a session's Turn checkpoints, rows and anchor refs together - for a delete only.
 *
 * The refs pin a full tree per turn, untracked files included, and survive worktree removal, branch
 * deletion and `gc --prune=now`, so dropping only the rows left those objects reachable in the user's
 * repository forever. They are deleted against the primary checkout, where the shared namespace
 * lives, and that includes local-mode sessions, which capture into the opened checkout.
 *
 * Archiving keeps everything: it is reversible, and an archived session must come back whole.
 */
async function discardCheckpoints(
  input: {
    readonly sessionId: string
    readonly projectPath: string | null
    readonly reason: 'delete' | 'archive'
  },
  deps: PruneSessionWorktreeDeps,
) {
  if (input.reason === 'archive') return
  await deps.deleteCheckpoints(input.sessionId)
  if (input.projectPath) {
    await deleteSessionTurnCheckpointRefs(input.projectPath, input.sessionId)
  }
}

/**
 * Remove the worktree, reporting whether the removal failed.
 *
 * Removal is deliberately not forced, so git refuses a worktree holding uncommitted work. The
 * caller keeps the binding in that case: clearing it anyway left the user's work on disk in a
 * directory the app had just forgotten about, with nothing in the UI pointing at it.
 */
async function removalFailedFor(projectPath: string, worktreePath: string): Promise<boolean> {
  const result = await removeGitWorktree(projectPath, { path: worktreePath })
  if (result.ok) return false

  logger.warn('Kept the Session worktree binding because removal failed', {
    code: result.code,
    message: result.message,
  })
  return true
}
