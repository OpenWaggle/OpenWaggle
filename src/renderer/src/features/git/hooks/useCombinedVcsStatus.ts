import type { WorkingPath } from '@shared/types/brand'
import type { LocalVcsStatus, RemoteVcsStatus, VcsStatus } from '@shared/types/git'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('git')

/**
 * Loads the combined VCS status for a project: Local status resolves instantly,
 * Remote status loads asynchronously and is merged in when it arrives. Returns
 * null until the local half is available.
 */
export function useCombinedVcsStatus(workingPath: WorkingPath | null) {
  const [local, setLocal] = useState<LocalVcsStatus | null>(null)
  const [remote, setRemote] = useState<RemoteVcsStatus | null>(null)
  const requestedPath = useRef(workingPath)
  /** The path the values currently in state were actually loaded from. */
  const loadedPath = useRef<WorkingPath | null>(null)

  const refresh = useCallback(async () => {
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
    try {
      const localResult = await api.getLocalVcsStatus(workingPath)
      if (requestedPath.current !== workingPath) return
      setLocal(localResult.ok ? localResult.status : null)
      loadedPath.current = workingPath
    } catch (error) {
      logger.warn('Failed to load local VCS status', { error: String(error) })
      setLocal(null)
    }

    if (typeof api.getRemoteVcsStatus !== 'function') return
    try {
      const remoteResult = await api.getRemoteVcsStatus(workingPath)
      if (requestedPath.current !== workingPath) return
      setRemote(remoteResult.ok ? remoteResult.status : null)
    } catch (error) {
      logger.warn('Failed to load remote VCS status', { error: String(error) })
      setRemote(null)
    }
  }, [workingPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
