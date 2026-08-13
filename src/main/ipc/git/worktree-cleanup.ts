/**
 * Pure Session-worktree orphan/cleanup logic (ADR 0010).
 *
 * A Session worktree is only safe to remove when no other session still points at
 * the same worktree path, so we never delete a checkout another line of work is
 * using. Generalized to account for conversation forks, which share one worktree.
 */

export interface SessionWorktreeRef {
  readonly sessionId: string
  readonly worktreePath: string | null
}

export { formatWorktreePathForDisplay } from '@shared/utils/worktree'

export function normalizeWorktreePath(worktreePath: string | null | undefined): string | null {
  const trimmed = worktreePath?.trim()
  return trimmed ? trimmed : null
}

/**
 * Returns the worktree path to remove for the given session, or null when the
 * session has no worktree or another session still shares that path.
 */
export function getOrphanedWorktreePathForSession(
  sessions: readonly SessionWorktreeRef[],
  sessionId: string,
): string | null {
  const target = sessions.find((session) => session.sessionId === sessionId)
  if (!target) return null

  const targetPath = normalizeWorktreePath(target.worktreePath)
  if (!targetPath) return null

  const isShared = sessions.some(
    (session) =>
      session.sessionId !== sessionId && normalizeWorktreePath(session.worktreePath) === targetPath,
  )

  return isShared ? null : targetPath
}
