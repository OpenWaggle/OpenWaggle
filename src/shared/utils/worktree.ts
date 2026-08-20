import { WorkingPath } from '../types/brand'

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
 *
 * The sole producer of a {@link WorkingPath}: branding the result here means a
 * working-tree read or mutation can only be fed from this rule, never from a raw
 * repository path. In local mode the working tree is the checkout itself, so the
 * repository path is rebranded as the working path — same string, correct role.
 */
export function resolveSessionWorkingDir(
  session: {
    readonly environmentMode?: 'local' | 'worktree'
    readonly worktreePath?: string | null
  } | null,
  openedProjectPath: string | null,
): WorkingPath | null {
  if (session?.environmentMode === 'worktree' && session.worktreePath) {
    return WorkingPath(session.worktreePath)
  }
  return openedProjectPath === null ? null : WorkingPath(openedProjectPath)
}

/**
 * Length of the session-id prefix used in a Session worktree's branch name.
 */
const SESSION_WORKTREE_SHORT_ID_LENGTH = 8

/**
 * The single owner of the Session worktree branch namespace.
 *
 * Two independent features mint branches here: ADR 0010/0018 Session worktrees (keyed by a
 * session-id prefix) and MCP session-control worktrees (keyed by a content hash that also
 * names their directory). Their ids differ on purpose, but the namespace must be defined
 * once so renaming it cannot leave one feature behind.
 */
export const SESSION_WORKTREE_BRANCH_PREFIX = 'ow/session-'

/** Branch for an already-derived worktree id, whatever scheme produced it. */
export function sessionWorktreeBranchForId(worktreeId: string): string {
  return `${SESSION_WORKTREE_BRANCH_PREFIX}${worktreeId}`
}

/**
 * The branch a Session worktree lives on.
 *
 * Single source of truth for this convention: worktree birth and worktree recreation
 * must agree exactly, because recreation reattaches the surviving branch to preserve
 * commits made in the old tree. When the two derived the name differently, recreation
 * silently created a divergent branch and stranded the session's commits on the old one.
 */
export function sessionWorktreeBranch(sessionId: string): string {
  return sessionWorktreeBranchForId(sessionId.slice(0, SESSION_WORKTREE_SHORT_ID_LENGTH))
}
