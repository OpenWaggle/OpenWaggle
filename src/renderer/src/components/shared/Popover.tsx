import { useEffect } from 'react'
import { usePopover } from '@/hooks/usePopover'
import { cn } from '@/lib/cn'

type Placement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'

const placementClasses: Record<Placement, string> = {
  'top-start': 'bottom-full left-0 mb-1',
  'top-end': 'bottom-full right-0 mb-1',
  'bottom-start': 'top-full left-0 mt-1',
  'bottom-end': 'top-full right-0 mt-1',
}

interface PopoverProps {
  /** The trigger element. A ReactNode renders as-is; a render function receives popover state. */
  trigger: React.ReactNode | ((state: { isOpen: boolean; toggle: () => void }) => React.ReactNode)
  /** Dropdown content rendered when open. */
  children: React.ReactNode
  /** Controlled open state. When provided, the component is fully controlled. */
  open?: boolean
  /** Called when the popover wants to change its open state (controlled mode). */
  onOpenChange?: (open: boolean) => void
  /** Dropdown placement relative to the trigger. */
  placement?: Placement
  /** Additional classes for the dropdown panel. */
  className?: string
}

export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom-start',
  className,
}: PopoverProps): React.JSX.Element {
  const isControlled = controlledOpen !== undefined
  const popover = usePopover({
    onClose: () => onOpenChange?.(false),
    isActive: isControlled ? controlledOpen : undefined,
  })

  const isOpen = isControlled ? controlledOpen : popover.isOpen

  function toggle(): void {
    if (isControlled) {
      onOpenChange?.(!controlledOpen)
    } else {
      popover.toggle()
    }
  }

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (isControlled) {
          onOpenChange?.(false)
        } else {
          popover.close()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, isControlled, onOpenChange, popover])

  const triggerContent = typeof trigger === 'function' ? trigger({ isOpen, toggle }) : trigger

  return (
    <div ref={popover.containerRef} className="relative">
      {triggerContent}

      {isOpen && (
        <div
          className={cn(
            'absolute z-50 rounded-lg border border-border-light bg-bg-secondary shadow-lg',
            placementClasses[placement],
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
