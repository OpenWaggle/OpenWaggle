import { CircleAlert, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'

export const VIEWER_DIALOG_CLASS =
  'size-full max-h-none max-w-none overflow-hidden rounded-none border-0 bg-bg p-0'

export function SessionResourceViewerCatalogState({
  loading,
  errorMessage,
  onRetry,
  onClose,
}: {
  readonly loading: boolean
  readonly errorMessage: string | null
  readonly onRetry: () => void
  readonly onClose: () => void
}) {
  return (
    <ModalDialog label="Image viewer" onClose={onClose} className={VIEWER_DIALOG_CLASS}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <p className="text-sm font-medium text-text-primary">Image viewer</p>
          <Button variant="ghost" size="icon-sm" aria-label="Close image viewer" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-bg-tertiary p-8">
          {loading ? (
            <div role="status" className="flex items-center gap-2 text-sm text-text-tertiary">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Loading this session’s images…
            </div>
          ) : (
            <div
              role="alert"
              className="max-w-sm rounded-lg border border-border bg-bg-secondary p-6 text-center"
            >
              <CircleAlert className="mx-auto mb-3 size-5 text-warning" aria-hidden="true" />
              <p className="text-sm font-medium text-text-primary">
                {errorMessage
                  ? 'Couldn’t load this session’s images.'
                  : 'This image is no longer available in this session.'}
              </p>
              {errorMessage ? (
                <p className="mt-1 text-xs text-text-tertiary">{errorMessage}</p>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                aria-label="Retry loading session images"
                onClick={onRetry}
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    </ModalDialog>
  )
}
