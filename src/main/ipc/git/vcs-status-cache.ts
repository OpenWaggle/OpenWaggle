import type { LocalVcsStatusResult, RemoteVcsStatusResult } from '@shared/types/git'
import { getLocalVcsStatus, getRemoteVcsStatus } from './vcs-status-service'

const localCache = new Map<string, Promise<LocalVcsStatusResult>>()
const remoteCache = new Map<string, Promise<RemoteVcsStatusResult>>()

export function readLocalVcsStatus(projectPath: string): Promise<LocalVcsStatusResult> {
  const cached = localCache.get(projectPath)
  if (cached) return cached
  const pending = getLocalVcsStatus(projectPath)
  localCache.set(projectPath, pending)
  // Drop failed lookups so the next read retries instead of caching the error.
  void pending.then((result) => {
    if (!result.ok) localCache.delete(projectPath)
  })
  return pending
}

export function readRemoteVcsStatus(projectPath: string): Promise<RemoteVcsStatusResult> {
  const cached = remoteCache.get(projectPath)
  if (cached) return cached
  const pending = getRemoteVcsStatus(projectPath)
  remoteCache.set(projectPath, pending)
  void pending.then((result) => {
    if (!result.ok) remoteCache.delete(projectPath)
  })
  return pending
}

export function invalidateLocalVcsStatus(projectPath?: string): void {
  if (projectPath) localCache.delete(projectPath)
  else localCache.clear()
}

export function invalidateRemoteVcsStatus(projectPath?: string): void {
  if (projectPath) remoteCache.delete(projectPath)
  else remoteCache.clear()
}

export function invalidateVcsStatus(projectPath?: string): void {
  invalidateLocalVcsStatus(projectPath)
  invalidateRemoteVcsStatus(projectPath)
}
