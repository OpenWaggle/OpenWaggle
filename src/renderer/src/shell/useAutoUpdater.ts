import { PRODUCT_NAME } from '@shared/build-identity-runtime'
import type { UpdateStatus } from '@shared/types/updater'
import { useEffect, useRef } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('updater')

type DownloadedUpdateStatus = Extract<UpdateStatus, { readonly type: 'downloaded' }>

interface UpdaterToast {
  readonly message: string
  readonly variant: 'success' | 'neutral' | 'error'
  readonly action?: { readonly label: string; readonly run: () => Promise<void> }
}

function installingToast(version: string): UpdaterToast {
  return {
    message: `Installing update v${version}. ${PRODUCT_NAME} will reopen when it is done.`,
    variant: 'neutral',
  }
}

function updaterToast(status: DownloadedUpdateStatus): UpdaterToast {
  const waitingForRuns = status.waitingForRuns
  if (waitingForRuns !== undefined && waitingForRuns > 0) {
    const runs = waitingForRuns === 1 ? '1 agent run' : `${waitingForRuns} agent runs`
    return {
      message: `Update v${status.version} will install when ${runs} finish${waitingForRuns === 1 ? 'es' : ''}`,
      variant: 'success',
      action: { label: 'Restart now', run: () => api.installUpdateNow() },
    }
  }
  if (status.installFailure) {
    return {
      message: status.installFailure,
      variant: 'error',
      action: { label: 'Restart to update', run: () => api.installUpdate() },
    }
  }
  return {
    message: `Update v${status.version} ready`,
    variant: 'success',
    action: { label: 'Restart to update', run: () => api.installUpdate() },
  }
}

export function useAutoUpdater(): void {
  const showPersistentToast = useUIStore((s) => s.showPersistentToast)
  const clearToast = useUIStore((s) => s.clearToast)
  const shownToastRef = useRef<UpdaterToast | null>(null)

  useEffect(() => {
    if (typeof api.onUpdateStatus !== 'function') return

    const clearShownToast = () => {
      const shown = shownToastRef.current
      if (!shown) return
      const visibleToast = useUIStore.getState().toastData
      if (
        visibleToast?.message === shown.message &&
        visibleToast.action?.label === shown.action?.label
      ) {
        clearToast()
      }
      shownToastRef.current = null
    }

    const unsubscribe = api.onUpdateStatus((status: UpdateStatus) => {
      if (status.type === 'downloaded' || status.type === 'installing') {
        const next =
          status.type === 'installing' ? installingToast(status.version) : updaterToast(status)
        if (shownToastRef.current?.message === next.message) return
        clearShownToast()
        shownToastRef.current = next
        const action = next.action
        showPersistentToast({
          message: next.message,
          variant: next.variant,
          persistent: true,
          ...(action
            ? {
                action: {
                  label: action.label,
                  onClick: () => {
                    action.run().catch((err: unknown) => {
                      logger.warn('Failed to install update', { error: String(err) })
                    })
                  },
                },
              }
            : {}),
        })
        return
      }
      if (status.type === 'idle' || status.type === 'not-available' || status.type === 'error') {
        clearShownToast()
      }
    })

    return unsubscribe
  }, [clearToast, showPersistentToast])
}
