import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useClickOutside } from '@/hooks/useClickOutside'
import { cn } from '@/lib/cn'

interface ContextMenuProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly position: { readonly x: number; readonly y: number }
  readonly children: React.ReactNode
}

export function ContextMenu({
  open,
  onClose,
  position,
  children,
}: ContextMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null)
  useClickOutside(menuRef, onClose, open)

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        'fixed z-50 min-w-[160px] py-1 rounded-lg border border-border-light bg-bg-secondary shadow-lg',
      )}
      style={{ left: position.x, top: position.y }}
    >
      {children}
    </div>,
    document.body,
  )
}
