import { useRef, useState } from 'react'
import { useClickOutside } from '@/shared/hooks/useClickOutside'

interface UsePopoverOptions {
  onClose?: () => void
  /** Override the click-outside guard (useful for controlled mode). */
  isActive?: boolean
}

export function usePopover(options: UsePopoverOptions = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  function open() {
    setIsOpen(true)
  }

  function close() {
    setIsOpen(false)
    options.onClose?.()
  }

  function toggle() {
    if (isOpen) {
      close()
    } else {
      open()
    }
  }

  useClickOutside(containerRef, close, options.isActive ?? isOpen)

  return { isOpen, open, close, toggle, containerRef }
}
