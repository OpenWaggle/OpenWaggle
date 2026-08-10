import type { LocalVcsStatusResult, RemoteVcsStatusResult } from '@shared/types/git'
import { getLocalVcsStatus, getRemoteVcsStatus } from './vcs-status-service'

/** Short TTL for the network-free local status; longer for remote (runs `git fetch`). */
const LOCAL_TTL_MS = 2_000
const REMOTE_TTL_MS = 15_000

interface CacheEntry<T> {
  readonly pending: Promise<T>
  readonly expiresAt: number
}

const localCache = new Map<string, CacheEntry<LocalVcsStatusResult>>()
const remoteCache = new Map<string, CacheEntry<RemoteVcsStatusResult>>()

function readCached<T extends { readonly ok: boolean }>(
  cache: Map<string, CacheEntry<T>>,
  projectPath: string,
  ttlMs: number,
  fetch: (projectPath: string) => Promise<T>,
): Promise<T> {
  const cached = cache.get(projectPath)
  if (cached && cached.expiresAt > Date.now()) return cached.pending

  const pending = fetch(projectPath)
  cache.set(projectPath, { pending, expiresAt: Date.now() + ttlMs })
  // Drop failed or rejected lookups so the next read retries instead of caching
  // (and never poisons) the entry. Only the currently-stored entry is cleared.
  const clearIfCurrent = () => {
    if (cache.get(projectPath)?.pending === pending) cache.delete(projectPath)
  }
  pending.then((result) => {
    if (!result.ok) clearIfCurrent()
  }, clearIfCurrent)
  return pending
}

export function readLocalVcsStatus(projectPath: string): Promise<LocalVcsStatusResult> {
  return readCached(localCache, projectPath, LOCAL_TTL_MS, getLocalVcsStatus)
}

export function readRemoteVcsStatus(projectPath: string): Promise<RemoteVcsStatusResult> {
  return readCached(remoteCache, projectPath, REMOTE_TTL_MS, getRemoteVcsStatus)
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
