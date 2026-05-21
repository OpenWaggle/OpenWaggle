import type { GitStatusSummary } from '@shared/types/git'

const statusCache = new Map<string, { result: GitStatusSummary; timestamp: number }>()

export function getCachedGitStatus(projectPath: string, ttlMs: number) {
  const cached = statusCache.get(projectPath)
  if (!cached || Date.now() - cached.timestamp >= ttlMs) return null
  return cached.result
}

export function setCachedGitStatus(projectPath: string, result: GitStatusSummary) {
  statusCache.set(projectPath, { result, timestamp: Date.now() })
}

export function invalidateGitStatusCache(projectPath?: string) {
  if (projectPath) {
    statusCache.delete(projectPath)
    return
  }
  statusCache.clear()
}
