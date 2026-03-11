import type { UpdateStatus } from '@shared/types/updater'
import { useEffect, useRef } from 'react'
import { api } from '@/lib/ipc'
import { useUIStore } from '@/stores/ui-store'

export function useAutoUpdater(): void {
  const showPersistentToast = useUIStore((s) => s.showPersistentToast)
  const hasShownRef = useRef(false)

  useEffect(() => {
    if (typeof api.onUpdateStatus !== 'function') return

    const unsubscribe = api.onUpdateStatus((status: UpdateStatus) => {
      if (status.type === 'downloaded' && !hasShownRef.current) {
        hasShownRef.current = true
        showPersistentToast({
          message: `Update v${status.version} ready`,
          variant: 'success',
          persistent: true,
          action: {
            label: 'Restart to update',
            onClick: () => {
              if (typeof api.installUpdate === 'function') {
                api.installUpdate().catch(() => {})
              }
            },
          },
        })
      }
    })

    return unsubscribe
  }, [showPersistentToast])
}
