import type { UpdateStatus } from '@shared/types/updater'
import { useEffect, useRef } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('updater')

export function useAutoUpdater(): void {
  const showPersistentToast = useUIStore((s) => s.showPersistentToast)
  const clearToast = useUIStore((s) => s.clearToast)
  const shownVersionRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof api.onUpdateStatus !== 'function') return

    const unsubscribe = api.onUpdateStatus((status: UpdateStatus) => {
      if (status.type === 'downloaded' && shownVersionRef.current !== status.version) {
        shownVersionRef.current = status.version
        showPersistentToast({
          message: `Update v${status.version} ready`,
          variant: 'success',
          persistent: true,
          action: {
            label: 'Restart to update',
            onClick: () => {
              if (typeof api.installUpdate === 'function') {
                api.installUpdate().catch((err: unknown) => {
                  logger.warn('Failed to install update', { error: String(err) })
                })
              }
            },
          },
        })
        return
      }
      if (
        shownVersionRef.current &&
        (status.type === 'idle' || status.type === 'not-available' || status.type === 'error')
      ) {
        const updaterMessage = `Update v${shownVersionRef.current} ready`
        const visibleToast = useUIStore.getState().toastData
        if (
          visibleToast?.message === updaterMessage &&
          visibleToast.action?.label === 'Restart to update'
        ) {
          clearToast()
        }
        shownVersionRef.current = null
      }
    })

    return unsubscribe
  }, [clearToast, showPersistentToast])
}
