import { AlertCircle, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'

export function CommitOrPushStatusDialog({
  error,
  onClose,
  onRetry,
}: {
  readonly error: string | null
  readonly onClose: () => void
  readonly onRetry: () => void
}) {
  return (
    <ModalDialog label="Commit or push" onClose={onClose}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Commit or push</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close commit or push" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="flex min-h-32 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
        {error ? (
          <>
            <AlertCircle className="size-5 text-error-text" aria-hidden="true" />
            <div role="alert">
              <p className="text-sm font-medium text-text-primary">Git status is unavailable</p>
              <p className="mt-1 text-xs text-text-tertiary">{error}</p>
            </div>
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          </>
        ) : (
          <div role="status" className="flex items-center gap-2 text-sm text-text-tertiary">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Loading detailed Git status…
          </div>
        )}
      </div>
    </ModalDialog>
  )
}
