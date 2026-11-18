import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from './Button'

interface CommandDialogProps {
  readonly title: string
  readonly description?: string
  readonly onClose: () => void
  readonly children: ReactNode
  readonly footer?: ReactNode
}

/**
 * The search field a command dialog opens on. `showModal()` runs the native dialog focusing steps,
 * which move focus to the first focusable descendant — the pointer-only backdrop control — and
 * override any `autoFocus` React applied before the dialog opened.
 */
const INITIAL_FOCUS_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"]'

/**
 * The element each mounted command dialog returns focus to, in mount order. A dialog that opens
 * while another is still mounted (the palette's "Go to file…" swaps surfaces in one commit, or
 * Suspense hides the palette while the picker's chunk loads) inherits that dialog's opener, so
 * closing the last surface of the chain returns focus to where the user started.
 */
const dialogOpeners = new Map<HTMLDialogElement, HTMLElement>()

function resolveOpener() {
  const inherited = [...dialogOpeners.values()].at(-1)
  if (inherited !== undefined) return inherited
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return null
  return active
}

export function CommandDialog({
  title,
  description,
  onClose,
  children,
  footer,
}: CommandDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  // Read during the first render, before the search field's `autoFocus` takes focus.
  const [opener] = useState(resolveOpener)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    if (opener) dialogOpeners.set(dialog, opener)
    dialog.showModal()
    dialog.querySelector<HTMLElement>(INITIAL_FOCUS_SELECTOR)?.focus({ preventScroll: true })
    return () => {
      dialogOpeners.delete(dialog)
      if (dialog.open) dialog.close()
      // Hand focus back to what opened the dialog, unless the chosen command already moved it.
      const focusDropped =
        document.activeElement === null ||
        document.activeElement === document.body ||
        dialog.contains(document.activeElement)
      if (focusDropped && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [opener])

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 m-0 flex size-full max-h-none max-w-none items-start justify-center border-0 bg-bg/60 px-4 pt-(--command-dialog-top-padding) text-text-primary backdrop-blur-[2px] [--command-dialog-top-padding:14vh]"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <Button
        variant="unstyled"
        type="button"
        tabIndex={-1}
        aria-label={`Dismiss ${title}`}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section className="relative z-1 flex max-h-(--command-dialog-max-height) w-full max-w-170 flex-col overflow-hidden rounded-xl border border-border-light bg-bg-secondary shadow-2xl shadow-bg/60 [--command-dialog-max-height:70vh]">
        <header className="flex min-h-12 items-center gap-3 border-b border-border px-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-text-primary">{title}</h2>
            {description && <p className="truncate text-xs text-text-muted">{description}</p>}
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
          <footer className="flex min-h-9 items-center gap-4 border-t border-border px-4 text-xs text-text-muted">
            {footer}
          </footer>
        )}
      </section>
    </dialog>
  )
}
