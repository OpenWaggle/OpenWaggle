import { matchBy } from '@diegogbrisa/ts-match'
import { PRODUCT_NAME } from '@shared/build-identity-runtime'
import type { UpdateStatus } from '@shared/types/updater'
import { useEffect, useRef } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { type ToastData, useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('updater')

type DownloadedUpdateStatus = Extract<UpdateStatus, { readonly type: 'downloaded' }>

interface UpdaterToast {
  readonly message: string
  readonly variant: NonNullable<ToastData['variant']>
  readonly action?: { readonly label: string; readonly run: () => Promise<void> }
}

function installingToast(version: string): UpdaterToast {
  return {
    message: `Installing v${version}. ${PRODUCT_NAME} reopens when it is done`,
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

/** The toast a status shows, or whether it clears the updater's toast or leaves it as it is. */
function toastFor(status: UpdateStatus): UpdaterToast | 'clear' | 'keep' {
  return matchBy(status, 'type')
    .with('downloaded', (downloaded) => updaterToast(downloaded))
    .with('installing', (installing) => installingToast(installing.version))
    .with('idle', () => 'clear' as const)
    .with('not-available', () => 'clear' as const)
    .with('error', () => 'clear' as const)
    .with('checking', () => 'keep' as const)
    .with('available', () => 'keep' as const)
    .with('downloading', () => 'keep' as const)
    .exhaustive()
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
      const next = toastFor(status)
      if (next === 'clear') {
        clearShownToast()
        return
      }
      if (next !== 'keep') {
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
      }
    })

    return unsubscribe
  }, [clearToast, showPersistentToast])
}
