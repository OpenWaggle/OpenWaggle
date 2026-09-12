import { useEffect } from 'react'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from './ui-store'

/** Startup quarantine is GUI-lifetime state; read it again when the workspace remounts. */
export function useDesktopNativeAdmissionNotice() {
  const showPersistentToast = useUIStore((state) => state.showPersistentToast)
  useEffect(() => {
    let disposed = false
    void api.getDesktopNativeAdmissionIssue().then(
      (issue) => {
        if (!disposed && issue !== null) {
          showPersistentToast({ message: issue, variant: 'error', persistent: true })
        }
      },
      () => {
        if (!disposed)
          showPersistentToast({
            message:
              'Could not read desktop ownership status. Native actions may be unavailable; try reopening OpenWaggle.',
            variant: 'error',
            persistent: true,
          })
      },
    )
    return () => {
      disposed = true
    }
  }, [showPersistentToast])
}
