import { type ReactNode, useEffect, useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from './Button'
import { SHEET_MAX_WIDTH_PX, SHEET_VIEWPORT_WIDTH } from './right-sidebar-layout-sizing'

interface RightSidebarSheetProps {
  readonly children: ReactNode
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

const FOCUSABLE_SELECTOR =
  '[data-right-sidebar-focus-target="true"], button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function RightSidebarSheet({ children, open, onOpenChange }: RightSidebarSheetProps) {
  const asideRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const fallbackFocusIdRef = useRef<string | null>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])
  useEffect(() => {
    const aside = asideRef.current
    if (!open || !aside) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openerRef.current = opener
    const summaryPanel = opener?.closest<HTMLElement>('[id^="session-summary-"]')
    fallbackFocusIdRef.current = summaryPanel ? `${summaryPanel.id}-toggle` : null

    const handleKeyDown = (event: KeyboardEvent) => {
      const topLayerDialog = Array.from(
        document.querySelectorAll<HTMLDialogElement>('dialog[open]'),
      ).find((dialog) => dialog !== aside && !aside.contains(dialog))
      if (topLayerDialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChangeRef.current(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(aside.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      )
      if (focusable.length === 0) {
        event.preventDefault()
        aside.focus({ preventScroll: true })
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)
      const active = document.activeElement
      if (event.shiftKey && (active === first || !aside.contains(active))) {
        event.preventDefault()
        last?.focus({ preventScroll: true })
        return
      }
      if (!event.shiftKey && (active === last || !aside.contains(active))) {
        event.preventDefault()
        first?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    queueMicrotask(() => {
      const target = aside.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(target ?? aside).focus({ preventScroll: true })
    })
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      queueMicrotask(() => {
        const openerTarget = openerRef.current?.isConnected ? openerRef.current : null
        const fallbackTarget = fallbackFocusIdRef.current
          ? document.getElementById(fallbackFocusIdRef.current)
          : null
        ;(openerTarget ?? fallbackTarget)?.focus({ preventScroll: true })
      })
    }
  }, [open])

  return (
    <div
      inert={!open}
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-200 ease-out',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <Button
        variant="unstyled"
        aria-label="Close right sidebar"
        className="absolute inset-0 bg-bg/35 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
      />
      <dialog
        ref={asideRef}
        aria-label="Right sidebar"
        aria-modal="true"
        data-right-sidebar-panel="true"
        className={cn(
          'absolute inset-y-0 right-0 m-0 min-w-0 max-w-none overflow-hidden border-l border-border bg-diff-bg p-0 text-inherit shadow-2xl shadow-bg/30 transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        data-right-sidebar-shell="true"
        open={open}
        style={{ width: `min(${SHEET_VIEWPORT_WIDTH}, ${String(SHEET_MAX_WIDTH_PX)}px)` }}
        tabIndex={-1}
      >
        {children}
      </dialog>
    </div>
  )
}
