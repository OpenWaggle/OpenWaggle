import type { GitStatusSummary } from '@shared/types/git'
import { broadcastToWindows } from '../../utils/broadcast'
import { invalidateGitBranchListReads } from './branch-list-cache'
import { joinPendingGitRead, type PendingGitRead } from './pending-read'

const statusCache = new Map<string, { result: GitStatusSummary; timestamp: number }>()
const pendingStatus = new Map<string, PendingGitRead<GitStatusSummary>>()
const projectGenerations = new Map<string, number>()
let globalGeneration = 0

export interface GitStatusCacheToken {
  readonly globalGeneration: number
  readonly projectGeneration: number
}

export function getGitStatusCacheToken(projectPath: string): GitStatusCacheToken {
  return {
    globalGeneration,
    projectGeneration: projectGenerations.get(projectPath) ?? 0,
  }
}

export function getCachedGitStatus(projectPath: string, ttlMs: number) {
  const cached = statusCache.get(projectPath)
  if (!cached || Date.now() - cached.timestamp >= ttlMs) return null
  return cached.result
}

export function readCachedGitStatus(
  projectPath: string,
  ttlMs: number,
  load: () => Promise<GitStatusSummary>,
): Promise<GitStatusSummary> {
  const cached = getCachedGitStatus(projectPath, ttlMs)
  if (cached) return Promise.resolve(cached)
  const existing = joinPendingGitRead(pendingStatus.get(projectPath))
  if (existing) return existing
  const token = getGitStatusCacheToken(projectPath)
  const pending = Promise.resolve()
    .then(load)
    .then((result) => {
      if (pendingStatus.get(projectPath)?.promise === pending) {
        setCachedGitStatus(projectPath, result, token)
      }
      return result
    })
  pendingStatus.set(projectPath, { promise: pending, startedAt: Date.now() })
  const clear = () => {
    if (pendingStatus.get(projectPath)?.promise === pending) pendingStatus.delete(projectPath)
  }
  void pending.then(clear, clear)
  return pending
}

export function setCachedGitStatus(
  projectPath: string,
  result: GitStatusSummary,
  token: GitStatusCacheToken,
) {
  const currentToken = getGitStatusCacheToken(projectPath)
  if (
    token.globalGeneration !== currentToken.globalGeneration ||
    token.projectGeneration !== currentToken.projectGeneration
  ) {
    return
  }
  statusCache.set(projectPath, { result, timestamp: Date.now() })
}

/**
 * Whether two paths address the same working tree, allowing for one being a
 * subdirectory of the other: staging in `/repo/src` changes the status reported for
 * `/repo`, so a mutation under one alias must invalidate the other.
 *
 * Safe against sibling worktrees because a Session worktree lives under
 * `~/.openwaggle/worktrees/<repo>/<sessionId>`, never inside the project directory,
 * so it can never be a prefix-descendant of the checkout it was forked from. The
 * separator check stops `/repo2` matching `/repo`.
 *
 * A worktree the user created manually inside the project directory would be
 * over-invalidated. That is wasteful rather than wrong — it re-fetches status — and
 * is the safe direction to err in.
 */
export function isSameWorkingTree(a: string, b: string): boolean {
  const left = normalizeTreePath(a)
  const right = normalizeTreePath(b)
  if (left === right) return true
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function normalizeTreePath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function invalidateGitStatusCache(workingPath?: string) {
  invalidateGitBranchListReads()
  if (workingPath === undefined) {
    globalGeneration += 1
    projectGenerations.clear()
    statusCache.clear()
    pendingStatus.clear()
    return
  }

  // Every alias of the mutated tree, plus the mutation path itself, so a renderer
  // keyed on any of them converges.
  const affected = new Set<string>([workingPath])
  for (const cachedPath of [
    ...statusCache.keys(),
    ...pendingStatus.keys(),
    ...projectGenerations.keys(),
  ]) {
    if (isSameWorkingTree(cachedPath, workingPath)) affected.add(cachedPath)
  }

  for (const path of affected) {
    projectGenerations.set(path, (projectGenerations.get(path) ?? 0) + 1)
    statusCache.delete(path)
    pendingStatus.delete(path)
    broadcastToWindows('git:working-tree-changed', { workingPath: path })
  }
}
