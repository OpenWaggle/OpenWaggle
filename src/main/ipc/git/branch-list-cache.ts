import type { GitBranchListResult } from '@shared/types/git'
import { subscribeGitStatusInvalidation } from '../../services/git-status-cache'
import { listGitBranches } from './branch-list'
import { joinPendingGitRead, type PendingGitRead } from './pending-read'

const pendingLists = new Map<string, PendingGitRead<GitBranchListResult>>()

/** Join concurrent readers only; completed lists are always refreshed on the next request. */
export function readGitBranchList(projectPath: string): Promise<GitBranchListResult> {
  const existing = joinPendingGitRead(pendingLists.get(projectPath))
  if (existing) return existing
  const pending = Promise.resolve().then(() => listGitBranches(projectPath))
  pendingLists.set(projectPath, { promise: pending, startedAt: Date.now() })
  const clear = () => {
    if (pendingLists.get(projectPath)?.promise === pending) pendingLists.delete(projectPath)
  }
  void pending.then(clear, clear)
  return pending
}

export function invalidateGitBranchListReads(): void {
  // Linked worktrees share branch refs even when their filesystem paths are unrelated.
  pendingLists.clear()
}

subscribeGitStatusInvalidation(invalidateGitBranchListReads)
