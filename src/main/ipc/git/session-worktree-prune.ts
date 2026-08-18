import { deleteSessionTurnCheckpointRefs } from '../../adapters/git/turn-checkpoint-refs'
import { createLogger } from '../../logger'
import { getOrphanedWorktreePathForSession, type SessionWorktreeRef } from './worktree-cleanup'
import { removeGitWorktree } from './worktree-service'

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
  },
  deps: PruneSessionWorktreeDeps,
): Promise<void> {
  try {
    const worktreePath = input.worktreePath?.trim()
    if (!worktreePath || !input.projectPath) {
      await deps.deleteCheckpoints(input.sessionId)
      // Local-mode sessions capture checkpoints in the opened checkout, so their refs leak too.
      if (input.projectPath) {
        await deleteSessionTurnCheckpointRefs(input.projectPath, input.sessionId)
      }
      return
    }

    const refs = await deps.listWorktreeRefs()
    const orphaned = getOrphanedWorktreePathForSession(refs, input.sessionId)
    const removalFailed = orphaned ? await removalFailedFor(input.projectPath, orphaned) : false
    if (!removalFailed) {
      await deps.clearWorktree(input.sessionId)
    }
    await deps.deleteCheckpoints(input.sessionId)
    /*
     * Anchor refs must go with the rows. They pin a full tree per turn (untracked files
     * included) and survive worktree removal, branch deletion and `gc --prune=now`, so
     * dropping only the rows left those objects reachable in the user's repository forever.
     * Deleted against the primary checkout, which is where the shared ref namespace lives.
     */
    await deleteSessionTurnCheckpointRefs(input.projectPath, input.sessionId)
  } catch (error) {
    logger.warn('Failed to prune Session worktree', { error: String(error) })
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
