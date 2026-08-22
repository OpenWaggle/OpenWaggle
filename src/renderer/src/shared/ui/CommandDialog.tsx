import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { Button } from './Button'

interface CommandDialogProps {
  readonly title: string
  readonly description?: string
  readonly onClose: () => void
  readonly children: ReactNode
  readonly footer?: ReactNode
}

export function CommandDialog({
  title,
  description,
  onClose,
  children,
  footer,
}: CommandDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 m-0 flex size-full max-h-none max-w-none items-start justify-center border-0 bg-black/60 px-4 pt-[14vh] text-text-primary backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <section className="flex max-h-[70vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-border-light bg-bg-secondary shadow-2xl shadow-black/60">
        <header className="flex min-h-12 items-center gap-3 border-b border-border px-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13px] font-semibold text-text-primary">{title}</h2>
            {description && <p className="truncate text-[10px] text-text-muted">{description}</p>}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Close"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
        {footer && (
          <footer className="flex min-h-9 items-center gap-4 border-t border-border px-4 text-[10px] text-text-muted">
            {footer}
          </footer>
        )}
      </section>
    </dialog>
  )
}
