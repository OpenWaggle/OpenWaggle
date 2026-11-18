import type { SessionId } from '@shared/types/brand'
import { useLayoutEffect } from 'react'
import { api } from '@/shared/lib/ipc'

/**
 * Revokes opaque resource URLs as part of the route transition itself. This is separate from
 * resource queries because a destination Session might never open the resource browser.
 */
export function useSessionResourceOwnerActivation(sessionId: SessionId | null) {
  useLayoutEffect(() => {
    // The real preload method is one-way. Promise.resolve also absorbs the renderer's diagnostic
    // fallback when preload is unavailable, which already reports the failure to the console.
    void Promise.resolve(api.activateSessionResourceOwner(sessionId)).catch(() => undefined)
    return () => {
      void Promise.resolve(api.activateSessionResourceOwner(null)).catch(() => undefined)
    }
  }, [sessionId])
}
