import { useEffect, useRef } from 'react'
import { cn } from '@/shared/lib/cn'

interface ModalDialogProps {
  /** Accessible name. Omit when `labelledBy` points at a visible heading. */
  readonly label?: string
  /** Id of a visible heading that names the dialog (preferred over `label`). */
  readonly labelledBy?: string
  /** Invoked on Escape, backdrop dismissal, and any native close. */
  readonly onClose: () => void
  /** Classes for the dialog panel itself. */
  readonly className?: string
  readonly children: React.ReactNode
}

/**
 * Modal built on the native `<dialog>` element, which provides focus trapping,
 * Escape-to-close, top-layer stacking, and inert background content for free —
 * none of which a `role="dialog"` div gets (react-doctor/prefer-html-dialog).
 *
 * Mount it only while the modal should be shown; it opens on mount.
 */
export function ModalDialog({ label, labelledBy, onClose, className, children }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    // jsdom (component tests) doesn't implement showModal.
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.open = true
  }, [])

  return (
    <dialog
      ref={dialogRef}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': label })}
      onCancel={onClose}
      onClose={onClose}
      className={cn(
        // Tailwind's preflight sets `margin: 0` on every element, which overrides the
        // UA stylesheet's `margin: auto` that centres a modal dialog — so centring
        // must be restored explicitly here.
        'z-50 m-auto max-h-[90vh] w-full max-w-[620px] overflow-y-auto rounded-xl border border-border-light bg-bg-secondary text-text-primary shadow-2xl backdrop:bg-black/55',
        className,
      )}
    >
      {children}
    </dialog>
  )
}
