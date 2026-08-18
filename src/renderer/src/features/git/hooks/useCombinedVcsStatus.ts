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

  const refresh = useCallback(async () => {
    requestedPath.current = workingPath
    if (!workingPath || typeof api.getLocalVcsStatus !== 'function') {
      setLocal(null)
      setRemote(null)
      return
    }
    try {
      const localResult = await api.getLocalVcsStatus(workingPath)
      if (requestedPath.current !== workingPath) return
      setLocal(localResult.ok ? localResult.status : null)
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
