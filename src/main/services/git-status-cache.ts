import type { GitStatusSummary } from '@shared/types/git'
import { broadcastToWindows } from '../utils/broadcast'

const statusCache = new Map<string, { result: GitStatusSummary; timestamp: number }>()
const pendingStatusReads = new Map<
  string,
  {
    readonly pending: Promise<GitStatusSummary>
    readonly token: GitStatusCacheToken
    readonly startedAt: number
  }
>()
const projectGenerations = new Map<string, number>()
const invalidationListeners = new Set<() => void>()
const MAX_PENDING_READ_AGE_MS = 30_000
let globalGeneration = 0

/** Related Git read caches can follow status invalidation without importing IPC into services. */
export function subscribeGitStatusInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener)
  return () => invalidationListeners.delete(listener)
}

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

function sameCacheToken(left: GitStatusCacheToken, right: GitStatusCacheToken) {
  return (
    left.globalGeneration === right.globalGeneration &&
    left.projectGeneration === right.projectGeneration
  )
}

export function getOrLoadCachedGitStatus(
  projectPath: string,
  ttlMs: number,
  load: () => Promise<GitStatusSummary>,
): Promise<GitStatusSummary> {
  const cached = getCachedGitStatus(projectPath, ttlMs)
  if (cached !== null) return Promise.resolve(cached)
  const token = getGitStatusCacheToken(projectPath)
  const existing = pendingStatusReads.get(projectPath)
  if (
    existing &&
    sameCacheToken(existing.token, token) &&
    Date.now() - existing.startedAt >= 0 &&
    Date.now() - existing.startedAt < MAX_PENDING_READ_AGE_MS
  ) {
    return existing.pending
  }

  const pending = Promise.resolve()
    .then(load)
    .then((result) => {
      if (pendingStatusReads.get(projectPath)?.pending === pending) {
        setCachedGitStatus(projectPath, result, token)
      }
      return result
    })
    .finally(() => {
      if (pendingStatusReads.get(projectPath)?.pending === pending) {
        pendingStatusReads.delete(projectPath)
      }
    })
  pendingStatusReads.set(projectPath, { pending, token, startedAt: Date.now() })
  return pending
}

export function setCachedGitStatus(
  projectPath: string,
  result: GitStatusSummary,
  token: GitStatusCacheToken,
) {
  const currentToken = getGitStatusCacheToken(projectPath)
  if (!sameCacheToken(token, currentToken)) return
  statusCache.set(projectPath, { result, timestamp: Date.now() })
}

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
  for (const listener of invalidationListeners) listener()
  if (workingPath === undefined) {
    globalGeneration += 1
    projectGenerations.clear()
    statusCache.clear()
    pendingStatusReads.clear()
    return
  }

  const affected = new Set<string>([workingPath])
  for (const cachedPath of [
    ...statusCache.keys(),
    ...pendingStatusReads.keys(),
    ...projectGenerations.keys(),
  ]) {
    if (isSameWorkingTree(cachedPath, workingPath)) affected.add(cachedPath)
  }

  for (const path of affected) {
    projectGenerations.set(path, (projectGenerations.get(path) ?? 0) + 1)
    statusCache.delete(path)
    pendingStatusReads.delete(path)
    broadcastToWindows('git:working-tree-changed', { workingPath: path })
  }
}
