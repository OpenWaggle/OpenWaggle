import { canonicalJson } from '@shared/canonical-json'
import type { WorkingPath } from '@shared/types/brand'
import type { LocalVcsStatus, RemoteVcsStatus, VcsStatus } from '@shared/types/git'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('git')
// A status load fans out to several short-lived Git processes after the initial repository probe.
// Under process pressure the probe can fail before any repository command runs. Retry that transient
// state, but stop immediately when Git confirms that the folder is not a repository.
const LOCAL_STATUS_RETRY_DELAYS_MS = [250, 1_000, 4_000, 10_000] as const

type LocalLoadOutcome = 'loaded' | 'retryable-failure' | 'settled-failure' | 'stale'
export type RemoteVcsLoadState = 'loading' | 'loaded' | 'error' | 'unavailable'
export type LocalVcsLoadState = 'loading' | 'loaded' | 'error' | 'unavailable'

/**
 * Shared bookkeeping for one status load.
 *
 * Every state write is guarded inline by both the requested path and the request id. The path alone
 * cannot order two loads of the *same* path, and the refresh token makes those routine - every turn
 * end, broadcast and focus - so an older, slower response (or rejection) could otherwise land after a
 * newer one and put stale status back on screen. The comparison is written out at each write rather
 * than extracted, because a helper hides it from the analysis that checks exactly this.
 */
interface LoadGuard {
  /** A refresh of the tree already on screen keeps its last good answer through transient failures. */
  readonly revalidating: boolean
  readonly workingPath: WorkingPath
  readonly requestedPath: MutableRef<WorkingPath | null>
  readonly requestId: MutableRef<number>
  readonly thisRequest: number
}

interface MutableRef<T> {
  current: T
}

async function loadLocalStatus(
  input: LoadGuard & {
    readonly setLocal: (status: LocalVcsStatus | null) => void
    readonly loadedPath: MutableRef<WorkingPath | null>
    readonly loadedRef: MutableRef<string | null>
  },
): Promise<LocalLoadOutcome> {
  const { workingPath, requestedPath, requestId, thisRequest } = input
  try {
    const result = await api.getLocalVcsStatus(workingPath)
    if (requestedPath.current !== workingPath || requestId.current !== thisRequest) return 'stale'
    if (!result.ok) {
      if (result.code === 'not-a-repo') {
        input.setLocal(null)
        return 'settled-failure'
      }
      if (!input.revalidating) input.setLocal(null)
      return 'retryable-failure'
    }
    input.setLocal(result.status)
    input.loadedPath.current = workingPath
    input.loadedRef.current = refIdentity(result.status)
    return 'loaded'
  } catch (error) {
    logger.warn('Failed to load local VCS status', { error: String(error) })
    if (requestedPath.current !== workingPath || requestId.current !== thisRequest) return 'stale'
    if (!input.revalidating) input.setLocal(null)
    return 'retryable-failure'
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function loadLocalStatusWithRetry(
  input: LoadGuard & {
    readonly setLocal: (status: LocalVcsStatus | null) => void
    readonly loadedPath: MutableRef<WorkingPath | null>
    readonly loadedRef: MutableRef<string | null>
  },
) {
  let outcome = await loadLocalStatus(input)
  for (const retryDelay of LOCAL_STATUS_RETRY_DELAYS_MS) {
    if (outcome !== 'retryable-failure') return outcome
    await delay(retryDelay)
    if (
      input.requestedPath.current !== input.workingPath ||
      input.requestId.current !== input.thisRequest
    ) {
      return 'stale'
    }
    outcome = await loadLocalStatus(input)
  }
  return outcome
}

async function loadRemoteStatus(
  input: LoadGuard & {
    readonly setRemote: (status: RemoteVcsStatus | null) => void
    readonly setRemoteState: (state: RemoteVcsLoadState) => void
  },
) {
  const { workingPath, requestedPath, requestId, thisRequest } = input
  try {
    const result = await api.getRemoteVcsStatus(workingPath)
    if (requestedPath.current !== workingPath || requestId.current !== thisRequest) return
    if (result.ok) {
      input.setRemote(result.status)
      input.setRemoteState('loaded')
      return
    }
    if (input.revalidating) {
      logger.warn('Keeping the last remote VCS status after a failed revalidation', {
        code: result.code,
      })
      return
    }
    input.setRemote(null)
    input.setRemoteState('error')
  } catch (error) {
    logger.warn('Failed to load remote VCS status', { error: String(error) })
    if (requestedPath.current !== workingPath || requestId.current !== thisRequest) return
    if (input.revalidating) return
    input.setRemote(null)
    input.setRemoteState('error')
  }
}

/**
 * The branch a status belongs to. Remote status (pull request, upstream, ahead/behind) is per branch,
 * so a checkout inside the same working tree must not keep the previous branch's remote answer.
 */
function refIdentity(status: LocalVcsStatus) {
  return `${status.refName ?? ''}\u0000${status.pushTargetRef ?? ''}`
}

/** A refresh of the tree whose status is already on screen, as opposed to a first load. */
function isRevalidation(
  workingPath: WorkingPath | null,
  previousPath: WorkingPath | null,
  loadedPath: WorkingPath | null,
) {
  return workingPath !== null && workingPath === previousPath && workingPath === loadedPath
}

function localStateFor(outcome: Exclude<LocalLoadOutcome, 'stale'>): LocalVcsLoadState {
  if (outcome === 'loaded') return 'loaded'
  return outcome === 'settled-failure' ? 'unavailable' : 'error'
}

/**
 * Keeps the previous object when a revalidation returns the same status, so a routine refresh
 * (every turn boundary) re-renders nothing downstream.
 */
function keepIdentityWhenUnchanged<T>(setter: (update: (current: T | null) => T | null) => void) {
  return (next: T | null) =>
    setter((current) =>
      current !== null && next !== null && canonicalJson(current) === canonicalJson(next)
        ? current
        : next,
    )
}

/**
 * Loads the combined VCS status for a project: Local status resolves instantly,
 * Remote status loads asynchronously and is merged in when it arrives. Returns
 * null until the local half is available.
 */
export function useCombinedVcsStatus(
  workingPath: WorkingPath | null,
  /**
   * Bumped to retry.
   *
   * Without it a single failed status read left the quick action permanently disabled - rendering
   * "Git status is unavailable." - with no way back: the only other trigger was completing a stacked
   * action, which is exactly what the disabled button prevents. "Refresh diff" now reaches here too.
   */
  refreshToken: string | number = 0,
) {
  const [local, setLocalValue] = useState<LocalVcsStatus | null>(null)
  const [localState, setLocalState] = useState<LocalVcsLoadState>(
    workingPath ? 'loading' : 'unavailable',
  )
  const [remote, setRemoteValue] = useState<RemoteVcsStatus | null>(null)
  const [remoteState, setRemoteState] = useState<RemoteVcsLoadState>(
    workingPath ? 'loading' : 'unavailable',
  )
  const requestedPath = useRef(workingPath)
  /** The path the values currently in state were actually loaded from. */
  const loadedPath = useRef<WorkingPath | null>(null)
  /** The branch identity of the local status currently in state. */
  const loadedRef = useRef<string | null>(null)
  /**
   * Which load is current.
   *
   * The path check alone cannot order two loads of the *same* path, and the refresh token makes those
   * routine - every turn end, broadcast and focus. Without this an older, slower response could land
   * after a newer one and put stale status back on screen.
   */
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    requestId.current += 1
    const thisRequest = requestId.current
    const previousPath = requestedPath.current
    requestedPath.current = workingPath
    const setLocal = keepIdentityWhenUnchanged(setLocalValue)
    const setRemote = keepIdentityWhenUnchanged(setRemoteValue)
    /*
     * Drop the previous tree's status before fetching the new one. Keeping it across the await left
     * the quick action labelled from the tree the user just switched away from - and enabled - so a
     * fast click applied the old tree's decision to the new one. Null renders a disabled
     * "Git status is unavailable" button, which is the honest state while loading.
     *
     * Revalidating the tree whose status is already on screen keeps that status, and its loaded
     * state, until the new answer lands. Turn boundaries, focus and broadcasts refresh routinely;
     * flipping to "Checking Git status" / "Checking PR status" on each of them made the Session
     * Summary flash every turn although nothing had changed.
     */
    const revalidating = isRevalidation(workingPath, previousPath, loadedPath.current)
    if (!revalidating) {
      setLocal(null)
      setLocalState(workingPath ? 'loading' : 'unavailable')
      setRemote(null)
      setRemoteState(workingPath ? 'loading' : 'unavailable')
    }
    if (!workingPath || typeof api.getLocalVcsStatus !== 'function') {
      loadedPath.current = null
      return
    }
    // Capability checks do not depend on any response, so they are settled before the first await.
    const canReadRemote = typeof api.getRemoteVcsStatus === 'function'
    const previousRef = loadedRef.current
    const localOutcome = await loadLocalStatusWithRetry({
      revalidating,
      workingPath,
      requestedPath,
      requestId,
      thisRequest,
      setLocal,
      loadedPath,
      loadedRef,
    })
    if (localOutcome === 'stale') return
    // Same tree, different branch: the remote half on screen belongs to the previous branch.
    const remoteRevalidating = revalidating && loadedRef.current === previousRef
    if (revalidating && !remoteRevalidating) {
      setRemote(null)
      setRemoteState('loading')
    }
    setLocalState(localStateFor(localOutcome))
    if (localOutcome !== 'loaded') {
      setRemoteState(localOutcome === 'settled-failure' ? 'unavailable' : 'error')
      return
    }
    if (!canReadRemote) {
      setRemoteState('unavailable')
      return
    }
    await loadRemoteStatus({
      revalidating: remoteRevalidating,
      workingPath,
      requestedPath,
      requestId,
      thisRequest,
      setRemote,
      setRemoteState,
    })
  }, [workingPath])

  useEffect(() => {
    logger.debug('Loading VCS status', { refreshToken })
    void refresh()
    return () => {
      requestId.current += 1
    }
  }, [refresh, refreshToken])

  const status: VcsStatus | null = local ? { ...local, ...(remote ?? EMPTY_REMOTE) } : null

  return { status, local, localState, remote, remoteState, refresh }
}

const EMPTY_REMOTE: RemoteVcsStatus = {
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  aheadOfDefaultCount: null,
  changeRequest: null,
}
