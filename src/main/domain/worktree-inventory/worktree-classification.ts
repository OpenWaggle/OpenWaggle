import type {
  WorktreeAttention,
  WorktreeInventoryGroup,
  WorktreeInventorySession,
} from '@shared/types/worktree-inventory'
import type { WorktreeRemovalBlocker } from '@shared/types/worktree-usage'

/** What the inventory knows about one worktree before it is classified. */
export interface WorktreeFacts {
  readonly managed: boolean
  readonly locked: boolean
  readonly sessions: readonly WorktreeInventorySession[]
  readonly blockers: readonly WorktreeRemovalBlocker[]
  readonly uncommittedChangeCount: number | null
  readonly unpublishedCommitCount: number | null
  readonly cleanupFailed: boolean
}

/** Sessions that are not archived and have no Run: archiving them is all removal needs from them. */
function openSessions(facts: WorktreeFacts) {
  return facts.sessions.filter((session) => !session.archived && !session.running)
}

/**
 * In use: something other than open, idle Sessions stops removal, such as a Run, a terminal, a
 * Project Action, the open project or the running app.
 */
function inUse(facts: WorktreeFacts) {
  return (
    facts.sessions.some((session) => session.running) ||
    facts.blockers.some((blocker) => blocker.kind !== 'session')
  )
}

/**
 * The latest Archive time when every Session working in the worktree is archived and idle; null
 * when one is not, none is recorded, or no Session works in it.
 */
export function worktreeArchivedAt(sessions: readonly WorktreeInventorySession[]) {
  if (sessions.length === 0) return null
  let latest = 0
  for (const session of sessions) {
    if (!session.archived || session.running || session.archivedAt === null) return null
    latest = Math.max(latest, session.archivedAt)
  }
  return latest
}

export function worktreeAttention(facts: WorktreeFacts): readonly WorktreeAttention[] {
  const attention: WorktreeAttention[] = []
  const open = openSessions(facts).length
  if (open > 0) attention.push({ kind: 'open-sessions', count: open })
  if (facts.cleanupFailed) attention.push({ kind: 'cleanup-failed' })
  if (facts.uncommittedChangeCount === null || facts.unpublishedCommitCount === null) {
    attention.push({ kind: 'unknown-state' })
  }
  if (facts.uncommittedChangeCount !== null && facts.uncommittedChangeCount > 0) {
    attention.push({ kind: 'uncommitted-changes', count: facts.uncommittedChangeCount })
  }
  if (facts.unpublishedCommitCount !== null && facts.unpublishedCommitCount > 0) {
    attention.push({ kind: 'unpublished-commits', count: facts.unpublishedCommitCount })
  }
  if (facts.locked) attention.push({ kind: 'locked' })
  return attention
}

/**
 * Safe to remove, Needs a decision, or In use (ADR 0060). A worktree that open Sessions work in
 * is In use, not a decision: it is current work, which Archive & remove can still end.
 */
export function classifyWorktree(facts: WorktreeFacts): {
  readonly group: WorktreeInventoryGroup
  readonly attention: readonly WorktreeAttention[]
} {
  const attention = worktreeAttention(facts)
  if (inUse(facts) || openSessions(facts).length > 0) return { group: 'in-use', attention }
  return { group: attention.length === 0 ? 'safe' : 'decide', attention }
}
