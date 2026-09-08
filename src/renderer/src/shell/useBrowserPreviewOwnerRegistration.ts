import { useEffect } from 'react'
import { ensureBrowserPreviewOwnerRegistered } from './browser-preview-owner-runtime'
import { useUIStore } from './ui-store'

/**
 * Registers every Session once for the renderer lifetime. Session switches only
 * detach the native view; archive/deletion explicitly revoke the owner binding.
 */
export function useBrowserPreviewOwnerRegistration(ownerKey: string) {
  useEffect(() => {
    let active = true
    void ensureBrowserPreviewOwnerRegistered(ownerKey).catch((error: unknown) => {
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
    }
  }, [ownerKey])
}
