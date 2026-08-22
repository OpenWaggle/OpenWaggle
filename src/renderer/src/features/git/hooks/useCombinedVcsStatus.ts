import type { WorkingPath } from '@shared/types/brand'
import type { LocalVcsStatus, RemoteVcsStatus, VcsStatus } from '@shared/types/git'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('git')

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
  },
) {
  const { workingPath, requestedPath, requestId, thisRequest } = input
  try {
    const result = await api.getLocalVcsStatus(workingPath)
    if (requestedPath.current !== workingPath || requestId.current !== thisRequest) return
    input.setLocal(result.ok ? result.status : null)
    input.loadedPath.current = workingPath
  } catch (error) {
    logger.warn('Failed to load local VCS status', { error: String(error) })
    if (requestedPath.current !== workingPath || requestId.current !== thisRequest) return
    input.setLocal(null)
  }
}

async function loadRemoteStatus(
  input: LoadGuard & { readonly setRemote: (status: RemoteVcsStatus | null) => void },
) {
  const { workingPath, requestedPath, requestId, thisRequest } = input
  try {
    const result = await api.getRemoteVcsStatus(workingPath)
    if (requestedPath.current !== workingPath || requestId.current !== thisRequest) return
    input.setRemote(result.ok ? result.status : null)
  } catch (error) {
    logger.warn('Failed to load remote VCS status', { error: String(error) })
    if (requestedPath.current !== workingPath || requestId.current !== thisRequest) return
    input.setRemote(null)
  }
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
  refreshToken = 0,
) {
  const [local, setLocal] = useState<LocalVcsStatus | null>(null)
  const [remote, setRemote] = useState<RemoteVcsStatus | null>(null)
  const requestedPath = useRef(workingPath)
  /** The path the values currently in state were actually loaded from. */
  const loadedPath = useRef<WorkingPath | null>(null)
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
    /*
     * Drop the previous tree's status before fetching the new one. Keeping it across the await left
     * the quick action labelled from the tree the user just switched away from - and enabled - so a
     * fast click applied the old tree's decision to the new one. Null renders a disabled
     * "Git status is unavailable" button, which is the honest state while loading.
     */
    if (workingPath !== previousPath || workingPath !== loadedPath.current) {
      setLocal(null)
      setRemote(null)
    }
    if (!workingPath || typeof api.getLocalVcsStatus !== 'function') {
      loadedPath.current = null
      return
    }
    // Capability checks do not depend on any response, so they are settled before the first await.
    const canReadRemote = typeof api.getRemoteVcsStatus === 'function'
    await loadLocalStatus({
      workingPath,
      requestedPath,
      requestId,
      thisRequest,
      setLocal,
      loadedPath,
    })
    if (!canReadRemote) return
    await loadRemoteStatus({ workingPath, requestedPath, requestId, thisRequest, setRemote })
  }, [workingPath])

  useEffect(() => {
    logger.debug('Loading VCS status', { refreshToken })
    void refresh()
  }, [refresh, refreshToken])

  const status: VcsStatus | null = local ? { ...local, ...(remote ?? EMPTY_REMOTE) } : null

  return { status, local, remote, refresh }
}

const EMPTY_REMOTE: RemoteVcsStatus = {
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  aheadOfDefaultCount: null,
  changeRequest: null,
}
