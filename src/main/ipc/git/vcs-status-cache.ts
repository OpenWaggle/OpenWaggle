import type { LocalVcsStatusResult, RemoteVcsStatusResult } from '@shared/types/git'
import { resolveGitWorktreeScope } from '../../services/git/mutation-lock'
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

async function readCached<T extends { readonly ok: boolean }>(
  cache: Map<string, CacheEntry<T>>,
  projectPath: string,
  ttlMs: number,
  fetch: (projectPath: string) => Promise<T>,
): Promise<T> {
  // Status is checkout-specific: linked worktrees can have different HEADs, upstreams and dirty
  // files. Canonicalize aliases and opened subdirectories, but never collapse linked worktrees into
  // their shared common Git directory. The mutating fetch itself is repository-locked separately.
  const cacheKey = await resolveGitWorktreeScope(projectPath)
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.pending

  const pending = fetch(projectPath)
  // A slow network read must remain single-flight even after the eventual result's TTL would
  // otherwise have elapsed. Start the expiry clock only once the lookup settles successfully.
  cache.set(cacheKey, { pending, expiresAt: Number.POSITIVE_INFINITY })
  // Drop failed or rejected lookups so the next read retries instead of caching
  // (and never poisons) the entry. Only the currently-stored entry is cleared.
  const clearIfCurrent = () => {
    if (cache.get(cacheKey)?.pending === pending) cache.delete(cacheKey)
  }
  pending.then((result) => {
    if (!result.ok) {
      clearIfCurrent()
      return
    }
    if (cache.get(cacheKey)?.pending === pending) {
      cache.set(cacheKey, { pending, expiresAt: Date.now() + ttlMs })
    }
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
  // Resolving a common Git directory is asynchronous, while invalidation is deliberately immediate
  // on mutation paths. Clear this tiny cache conservatively so an alias cannot retain stale state.
  void projectPath
  localCache.clear()
}

export function invalidateRemoteVcsStatus(projectPath?: string): void {
  void projectPath
  remoteCache.clear()
}

export function invalidateVcsStatus(projectPath?: string): void {
  invalidateLocalVcsStatus(projectPath)
  invalidateRemoteVcsStatus(projectPath)
}
