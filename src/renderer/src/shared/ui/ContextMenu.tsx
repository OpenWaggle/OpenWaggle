import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useClickOutside } from '@/shared/hooks/useClickOutside'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { cn } from '@/shared/lib/cn'

interface ContextMenuProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly position: { readonly x: number; readonly y: number }
  readonly children: React.ReactNode
}

const VIEWPORT_MARGIN_PX = 8

export function ContextMenu({ open, onClose, position, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [resolvedPosition, setResolvedPosition] = useState(position)
  useClickOutside(menuRef, onClose, open)

  useEscapeHotkey(onClose, { enabled: open })

  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (menu === null) return
    const rect = menu.getBoundingClientRect()
    setResolvedPosition({
      x: Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(position.x, window.innerWidth - rect.width - VIEWPORT_MARGIN_PX),
      ),
      y: Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(position.y, window.innerHeight - rect.height - VIEWPORT_MARGIN_PX),
      ),
    })
  }, [open, position.x, position.y])

  if (!open) return null

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        'fixed z-50 min-w-40 py-1 rounded-lg border border-border-light bg-bg-secondary shadow-lg',
      )}
      style={{ left: resolvedPosition.x, top: resolvedPosition.y }}
    >
      {children}
    </div>,
    document.body,
  )
}
