import { useEffect } from 'react'
import { cn } from '@/lib/cn'

interface ConfirmDialogProps {
  readonly title: string
  readonly message: string
  readonly confirmLabel?: string
  readonly cancelLabel?: string
  readonly variant?: 'default' | 'warning' | 'danger'
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[380px] rounded-xl border border-border bg-bg-secondary p-5 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="mt-2 text-xs text-text-secondary leading-relaxed">{message}</p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              variant === 'danger' && 'bg-error/20 text-error hover:bg-error/30',
              variant === 'warning' && 'bg-warning/20 text-warning hover:bg-warning/30',
              variant === 'default' && 'bg-accent/20 text-accent hover:bg-accent/30',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
