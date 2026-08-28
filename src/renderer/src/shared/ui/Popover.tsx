import { cloneElement, isValidElement, useCallback, useEffect, useRef } from 'react'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { useMenuKeyboard } from '@/shared/hooks/useMenuKeyboard'
import { usePopover } from '@/shared/hooks/usePopover'
import { cn } from '@/shared/lib/cn'

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
  /**
   * ARIA role for the dropdown panel.
   *
   * A panel whose children declare `menuitem` or `menuitemradio` needs `menu` here: those roles
   * are only valid inside one, and without it a screen reader does not reliably announce the
   * checked state of a sort option.
   *
   * `menu` also switches on the keyboard model that role promises: arrow keys, Home and End move
   * between items, the panel is a single tab stop, focus enters it on open and returns to the
   * trigger on close. Declaring the role without that model tells a screen reader user to press
   * keys that do nothing, so the two are deliberately not separable.
   */
  role?: 'menu' | 'listbox' | 'dialog'
  /** Accessible name for non-menu popup panels such as searchable picker dialogs. */
  ariaLabel?: string
}

export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom-start',
  className,
  role,
  ariaLabel,
}: PopoverProps) {
  const isControlled = controlledOpen !== undefined
  const {
    isOpen: popoverIsOpen,
    close: popoverClose,
    toggle: popoverToggle,
    containerRef,
  } = usePopover({
    onClose: () => onOpenChange?.(false),
    isActive: isControlled ? controlledOpen : undefined,
  })

  const isOpen = isControlled ? controlledOpen : popoverIsOpen
  const isMenu = role === 'menu'
  const isDialog = role === 'dialog'
  const menuPanelRef = useRef<HTMLDivElement>(null)
  const dialogPanelRef = useRef<HTMLDialogElement>(null)
  const plainPanelRef = useRef<HTMLDivElement>(null)

  function toggle() {
    if (isControlled) {
      onOpenChange?.(!controlledOpen)
    } else {
      popoverToggle()
    }
  }

  const close = useCallback(() => {
    if (isControlled) {
      onOpenChange?.(false)
    } else {
      popoverClose()
    }
  }, [isControlled, onOpenChange, popoverClose])

  const handlePanelKeyDown = useMenuKeyboard({
    enabled: isMenu,
    isOpen,
    panelRef: menuPanelRef,
    onClose: close,
  })

  useEscapeHotkey(close, { enabled: isOpen })

  useEffect(() => {
    if (!isOpen || !isDialog) return
    const restoreFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const firstFocusable = dialogPanelRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    firstFocusable?.focus()
    return () => {
      if (restoreFocus?.isConnected) restoreFocus.focus()
    }
  }, [isDialog, isOpen])

  const panelClass = cn(
    'absolute z-50 cursor-default rounded-lg border border-border-light bg-bg-secondary shadow-lg',
    placementClasses[placement],
    className,
  )

  const triggerNode = typeof trigger === 'function' ? trigger({ isOpen, toggle }) : trigger
  /*
   * A menu trigger has to say so, and say whether it is open.
   *
   * Added here rather than at each call site so every menu reports it, and only when the trigger
   * has not already set them itself.
   */
  const triggerContent =
    (isMenu || isDialog) && isValidElement<React.AriaAttributes>(triggerNode)
      ? cloneElement(triggerNode, {
          'aria-haspopup': triggerNode.props['aria-haspopup'] ?? role,
          'aria-expanded': triggerNode.props['aria-expanded'] ?? isOpen,
        })
      : triggerNode

  return (
    <div ref={containerRef} className="relative">
      {triggerContent}

      {isOpen &&
        // Split so the menu panel carries a literal role alongside its key handler: a handler on a
        // panel whose role is only known at runtime reads as an interaction on a static element.
        (isMenu ? (
          <div ref={menuPanelRef} role="menu" onKeyDown={handlePanelKeyDown} className={panelClass}>
            {children}
          </div>
        ) : isDialog ? (
          <dialog
            ref={dialogPanelRef}
            open
            aria-label={ariaLabel}
            className={cn('m-0', panelClass)}
          >
            {children}
          </dialog>
        ) : (
          <div ref={plainPanelRef} role={role} className={panelClass}>
            {children}
          </div>
        ))}
    </div>
  )
}
