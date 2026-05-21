import { ExternalLink, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('toast')

export function ToastOverlay() {
  const toastData = useUIStore((s) => s.toastData)
  const clearToast = useUIStore((s) => s.clearToast)

  if (!toastData) {
    return null
  }

  const isSuccess = toastData.variant === 'success'
  const isError = toastData.variant === 'error'

  return (
    <div
      className={cn(
        'pointer-events-auto fixed right-5 top-16 z-[9999] flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-[13px] text-text-secondary shadow-lg',
        isSuccess && 'border-success/30 bg-success/8',
        isError && 'border-error/30 bg-error/8 text-error',
        !isSuccess && !isError && 'border-border-light bg-bg-secondary',
      )}
    >
      <span>{toastData.message}</span>
      {toastData.action && (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => {
            if (toastData.action?.onClick) {
              toastData.action.onClick()
            }
            if (!toastData.action?.onClick && toastData.action?.url) {
              api.openExternal(toastData.action.url).catch((err: unknown) => {
                logger.warn('Failed to open external URL', { error: String(err) })
              })
            }
            clearToast()
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10"
        >
          {toastData.action.label}
          {toastData.action.url && <ExternalLink className="size-3" />}
        </Button>
      )}
      {toastData.persistent && (
        <Button
          variant="unstyled"
          type="button"
          onClick={clearToast}
          className="rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          title="Dismiss"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
