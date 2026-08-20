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
      return
    }

    const refs = await deps.listWorktreeRefs()
    const orphaned = getOrphanedWorktreePathForSession(refs, input.sessionId)
    if (orphaned) {
      const result = await removeGitWorktree(input.projectPath, { path: orphaned })
      if (!result.ok) {
        logger.warn('Could not remove Session worktree during prune', {
          code: result.code,
          message: result.message,
        })
      }
    }
    await deps.clearWorktree(input.sessionId)
    await deps.deleteCheckpoints(input.sessionId)
  } catch (error) {
    logger.warn('Failed to prune Session worktree', { error: String(error) })
  }
}
