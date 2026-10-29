import { RepositoryPath } from '@shared/types/brand'
import type { GitWorktreeMutationResult } from '@shared/types/git'
import type { WorktreeInventory } from '@shared/types/worktree-inventory'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'
import { useRefreshWorktreeInventory } from './use-worktree-inventory'
import { approximateSpace } from './worktree-inventory-format'

const logger = createRendererLogger('settings')

/** One requested removal and how far it may go. */
export interface WorktreeRemovalRequest {
  readonly path: string
  /** The main checkout the removal runs from. */
  readonly projectPath: string
  /** Delete anyway: skip the Workspace cleanup. */
  readonly skipCleanup: boolean
  /** Discard uncommitted changes, and remove a locked worktree. */
  readonly force: boolean
  /**
   * What `force` is for, so the confirmation says only what is true. For Archive & remove,
   * `discardsChanges` only says the worktree may have changes, which then keep it.
   */
  readonly discardsChanges?: boolean
  readonly ignoresLock?: boolean
  /** Archive every Session working in it first (Archive & remove). */
  readonly archiveSessions?: boolean
  /** The Sessions the confirmation named, which are all Archive & remove may archive. */
  readonly sessionIds?: readonly string[]
}

/** Force, and whether it may only override Git's lock: the Host still refuses changes then. */
function forceFlags(request: WorktreeRemovalRequest) {
  if (!request.force) return {}
  return request.ignoresLock && !request.discardsChanges && !request.skipCleanup
    ? { force: true, lockOnly: true }
    : { force: true }
}

function sendRemoval(request: WorktreeRemovalRequest): Promise<GitWorktreeMutationResult> {
  const repositoryPath = RepositoryPath(request.projectPath)
  const force = forceFlags(request)
  if (request.archiveSessions) {
    // The Host overrides only the lock for Archive & remove; it never discards changes.
    return api.archiveAndRemoveWorktree(repositoryPath, {
      path: request.path,
      sessionIds: request.sessionIds ?? [],
      ...(request.force ? { force: true } : {}),
    })
  }
  return api.removeGitWorktree(repositoryPath, {
    path: request.path,
    ...(request.skipCleanup ? { skipCleanup: true } : {}),
    ...force,
  })
}

async function attempt(request: WorktreeRemovalRequest) {
  try {
    return await sendRemoval(request)
  } catch (error) {
    logger.warn('Failed to remove worktree', { error: String(error) })
    const message = `Could not remove the worktree: ${ipcErrorMessage(error)}`
    return { ok: false, code: 'unknown', message } as const
  }
}

/**
 * A cleanup failure is shown in full under the row once the list refreshes, which a brief toast
 * cannot do. When the refreshed row has no recovery to show, the toast says why.
 */
function failureToast(
  result: { readonly code: string; readonly message: string },
  refreshed: WorktreeInventory | undefined,
  path: string,
) {
  const shown = refreshed?.entries.some((entry) => entry.path === path && entry.cleanupFailure)
  return result.code === 'cleanup-failed' && shown
    ? 'The worktree was kept. The reason is shown under it.'
    : result.message
}

/** Removes worktrees one at a time, refreshes the page, and says what happened. */
export function useWorktreeRemoval() {
  const [busyPaths, setBusyPaths] = useState<ReadonlySet<string>>(() => new Set())
  const refresh = useRefreshWorktreeInventory()
  const showToast = useUIStore((state) => state.showToast)

  function setBusy(paths: readonly string[], busy: boolean) {
    setBusyPaths((current) => {
      const next = new Set(current)
      for (const path of paths) {
        if (busy) next.add(path)
        else next.delete(path)
      }
      return next
    })
  }

  async function remove(request: WorktreeRemovalRequest) {
    setBusy([request.path], true)
    const result = await attempt(request)
    if (!result.ok) logger.warn('Failed to remove worktree', { code: result.code })
    const refreshed = await refresh(result.ok ? [request] : [])
    setBusy([request.path], false)
    if (!result.ok) showToast(failureToast(result, refreshed, request.path), 'error')
  }

  /** "Free X": every safe worktree, each checked again by the Host. */
  async function removeMany(
    requests: readonly WorktreeRemovalRequest[],
    sizes: ReadonlyMap<string, number | null | undefined>,
  ) {
    const paths = requests.map((request) => request.path)
    setBusy(paths, true)
    const removed: WorktreeRemovalRequest[] = []
    let failed = 0
    // One at a time on purpose: each removal takes the repository's worktree lock and the
    // Host's Workspace fence, so parallel requests would only queue or fail there.
    for (const request of requests) {
      const result = await attempt(request)
      if (result.ok) removed.push(request)
      else failed += 1
    }
    await refresh(removed)
    setBusy(paths, false)
    const freed = approximateSpace(
      removed.map(({ path }) => path),
      sizes,
    )
    const count = `${String(removed.length)} ${removed.length === 1 ? 'worktree' : 'worktrees'}`
    const summary = freed === null ? `Removed ${count}.` : `Removed ${count}, freeing ${freed}.`
    if (failed === 0) showToast(summary, 'success')
    else {
      const kept =
        failed === 1
          ? '1 could not be removed and is'
          : `${String(failed)} could not be removed and are`
      showToast(`${summary} ${kept} still listed.`, 'error')
    }
  }

  return { busyPaths, remove, removeMany }
}
