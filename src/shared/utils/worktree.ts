/**
 * Pure display helper for Session worktree paths, shared between the main
 * process worktree service and the renderer worktree surface (ADR 0010).
 */
export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim()
  if (!trimmed) return worktreePath
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  const lastPart = parts[parts.length - 1]?.trim() ?? ''
  return lastPart.length > 0 ? lastPart : trimmed
}

/**
 * The effective working directory for a session's git operations (ADR 0010):
 * the Session worktree in worktree mode, otherwise the opened checkout. Used so
 * diff/status/revert/stage/stacked actions never target the wrong tree.
 */
export function resolveSessionWorkingDir(
  session: {
    readonly environmentMode?: 'local' | 'worktree'
    readonly worktreePath?: string | null
  } | null,
  openedProjectPath: string | null,
): string | null {
  if (session?.environmentMode === 'worktree' && session.worktreePath) {
    return session.worktreePath
  }
  return openedProjectPath
}
