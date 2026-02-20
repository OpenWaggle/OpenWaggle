import { useRef, useState } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'

interface UsePopoverOptions {
  onClose?: () => void
  /** Override the click-outside guard (useful for controlled mode). */
  isActive?: boolean
}

interface UsePopoverReturn {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function usePopover(options: UsePopoverOptions = {}): UsePopoverReturn {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  function open(): void {
    setIsOpen(true)
  }

  function close(): void {
    setIsOpen(false)
    options.onClose?.()
  }

  function toggle(): void {
    if (isOpen) {
      close()
    } else {
      open()
    }
  }

  useClickOutside(containerRef, close, options.isActive ?? isOpen)

  return { isOpen, open, close, toggle, containerRef }
}
