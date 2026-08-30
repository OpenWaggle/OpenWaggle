import type { GitStatusSummary } from '@shared/types/git'
import { broadcastToWindows } from '../utils/broadcast'

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
  if (workingPath === undefined) {
    globalGeneration += 1
    projectGenerations.clear()
    statusCache.clear()
    return
  }

  const affected = new Set<string>([workingPath])
  for (const cachedPath of [...statusCache.keys(), ...projectGenerations.keys()]) {
    if (isSameWorkingTree(cachedPath, workingPath)) affected.add(cachedPath)
  }

  for (const path of affected) {
    projectGenerations.set(path, (projectGenerations.get(path) ?? 0) + 1)
    statusCache.delete(path)
    broadcastToWindows('git:working-tree-changed', { workingPath: path })
  }
}
