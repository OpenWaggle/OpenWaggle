import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useEscapeHotkey } from '@/hooks/useEscapeHotkey'
import { cn } from '@/lib/cn'

interface ContextMenuProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly position: { readonly x: number; readonly y: number }
  readonly children: React.ReactNode
}

export function ContextMenu({ open, onClose, position, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  useClickOutside(menuRef, onClose, open)

  useEscapeHotkey(onClose, { enabled: open })

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
