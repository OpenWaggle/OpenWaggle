import type { GitStatusSummary } from '@shared/types/git'

const statusCache = new Map<string, { result: GitStatusSummary; timestamp: number }>()
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

export function invalidateGitStatusCache(projectPath?: string) {
  if (projectPath) {
    projectGenerations.set(projectPath, (projectGenerations.get(projectPath) ?? 0) + 1)
    statusCache.delete(projectPath)
    return
  }
  globalGeneration += 1
  projectGenerations.clear()
  statusCache.clear()
}
