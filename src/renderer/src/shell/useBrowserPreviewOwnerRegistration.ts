import { useEffect } from 'react'
import { api } from '@/shared/lib/ipc'
import { acquireBrowserPreviewOwner } from './browser-preview-owner-leases'
import { useUIStore } from './ui-store'

/**
 * Retains native previews and running Sessions across navigation, but releases
 * idle bindings so navigation history cannot exhaust the native owner limit.
 */
export function useBrowserPreviewOwnerRegistration(
  ownerKey: string,
  selectedPreviewId: string | null = null,
) {
  useEffect(() => {
    let active = true
    const lease = acquireBrowserPreviewOwner(ownerKey)
    void lease.ready
      .then(() => {
        if (!active || ownerKey.length === 0) return
        return api.setCurrentBrowserPreview(ownerKey, selectedPreviewId)
      })
      .catch((error: unknown) => {
        if (!active) return
        useUIStore
          .getState()
          .showToast(
            error instanceof Error ? error.message : 'Browser preview owner unavailable.',
            'error',
          )
      })
    return () => {
      active = false
      lease.release()
    }
  }, [ownerKey, selectedPreviewId])
}
