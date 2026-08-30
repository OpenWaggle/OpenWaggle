import { removeGitWorktree } from '../../adapters/git/worktree'
import { createLogger } from '../../logger'
import { getOrphanedWorktreePathForSession, type SessionWorktreeRef } from './worktree-cleanup'

const logger = createLogger('session-worktree-prune')

export interface PruneSessionWorktreeDeps {
  readonly listWorktreeRefs: () => Promise<readonly SessionWorktreeRef[]>
  readonly clearWorktree: (sessionId: string) => Promise<void>
}

export type PruneSessionWorktreeResult =
  | { readonly status: 'ready-for-deletion' }
  | {
      readonly status: 'retained'
      readonly reason: 'worktree-removal-refused' | 'workspace-reference-missing' | 'cleanup-failed'
    }

/**
 * Death path for a Session worktree (ADR 0010): remove the worktree only when no
 * other session shares it (orphan guard), then clear the binding and prune Turn
 * checkpoints. Store access is injected so this stays within the git module's
 * boundary. A refusal is returned to the caller so Session deletion can preserve
 * the durable Session and Workspace binding that keep the worktree discoverable.
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
    /** Host-loss recovery may encounter a worktree removed before its durable phase advanced. */
    readonly allowMissingWorktree?: boolean
  },
  deps: PruneSessionWorktreeDeps,
): Promise<PruneSessionWorktreeResult> {
  try {
    const worktreePath = input.worktreePath?.trim()
    if (!worktreePath || !input.projectPath) {
      return { status: 'ready-for-deletion' }
    }

    /*
     * Archiving keeps the worktree.
     *
     * `git worktree remove` refuses on modified or untracked content, but *ignored* content is not
     * dirty: it is deleted with the directory. Everything the user's own tooling put there and git was
     * told to ignore - `.env`, `node_modules`, build caches - was destroyed by an action that is
     * reversible, and recreating the tree from its branch cannot bring any of it back. Unarchiving
     * therefore has to find the tree still there; birth adopts it on the next send. A worktree that is
     * genuinely unwanted can be removed in Settings.
     */
    if (input.reason === 'archive') {
      return { status: 'ready-for-deletion' }
    }

    const refs = await deps.listWorktreeRefs()
    if (!refs.some((ref) => ref.sessionId === input.sessionId)) {
      return { status: 'retained', reason: 'workspace-reference-missing' }
    }
    const orphaned = getOrphanedWorktreePathForSession(refs, input.sessionId)
    const removalFailed = orphaned
      ? await removalFailedFor(input.projectPath, orphaned, input.allowMissingWorktree === true)
      : false
    if (removalFailed) {
      return { status: 'retained', reason: 'worktree-removal-refused' }
    }
    await deps.clearWorktree(input.sessionId)
    return { status: 'ready-for-deletion' }
  } catch (error) {
    logger.warn('Failed to prune Session worktree', { error: String(error) })
    return { status: 'retained', reason: 'cleanup-failed' }
  }
}

/**
 * Remove the worktree, reporting whether the removal failed.
 *
 * Removal is deliberately not forced, so git refuses a worktree holding uncommitted work. The
 * caller keeps the binding in that case: clearing it anyway left the user's work on disk in a
 * directory the app had just forgotten about, with nothing in the UI pointing at it.
 */
async function removalFailedFor(
  projectPath: string,
  worktreePath: string,
  allowMissingWorktree: boolean,
): Promise<boolean> {
  const result = await removeGitWorktree(projectPath, { path: worktreePath })
  if (result.ok) return false
  if (allowMissingWorktree && result.code === 'not-found') return false

  logger.warn('Kept the Session worktree binding because removal failed', {
    code: result.code,
    message: result.message,
  })
  return true
}
