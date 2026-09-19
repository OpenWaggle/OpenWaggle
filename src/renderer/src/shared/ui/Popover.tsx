import { match } from '@diegogbrisa/ts-match'
import {
  cloneElement,
  isValidElement,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { useMenuKeyboard } from '@/shared/hooks/useMenuKeyboard'
import { usePopover } from '@/shared/hooks/usePopover'
import { type PopoverPlacement, useTopLayerPopover } from '@/shared/hooks/useTopLayerPopover'
import { cn } from '@/shared/lib/cn'

const placementClasses: Record<PopoverPlacement, string> = {
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
  placement?: PopoverPlacement
  /** Keep menus usable inside clipped or scrolling panels through the native top layer. */
  escapeClipping?: boolean
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

function PopoverPanel({
  input,
  children,
}: {
  readonly input: {
    readonly role: PopoverProps['role']
    readonly menuRef: RefObject<HTMLDivElement | null>
    readonly dialogRef: RefObject<HTMLDialogElement | null>
    readonly plainRef: RefObject<HTMLDivElement | null>
    readonly escapeClipping: boolean
    readonly ariaLabel: string | undefined
    readonly className: string
    readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>
  }
  readonly children: ReactNode
}) {
  const popover = input.escapeClipping ? 'manual' : undefined
  // Literal roles keep the keyboard handler paired with the menu semantics it implements.
  return match(input.role)
    .with('menu', () => (
      <div
        ref={input.menuRef}
        popover={popover}
        role="menu"
        onKeyDown={input.onKeyDown}
        className={input.className}
      >
        {children}
      </div>
    ))
    .with('dialog', () => (
      <dialog
        ref={input.dialogRef}
        popover={popover}
        open
        aria-label={input.ariaLabel}
        className={cn('m-0', input.className)}
      >
        {children}
      </dialog>
    ))
    .with('listbox', undefined, (role) => (
      <div ref={input.plainRef} popover={popover} role={role} className={input.className}>
        {children}
      </div>
    ))
    .exhaustive()
}

export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom-start',
  escapeClipping = false,
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
  useTopLayerPopover({
    enabled: escapeClipping && isOpen,
    containerRef,
    panelRef: isMenu ? menuPanelRef : isDialog ? dialogPanelRef : plainPanelRef,
    placement,
  })

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

      {isOpen ? (
        <PopoverPanel
          input={{
            role,
            menuRef: menuPanelRef,
            dialogRef: dialogPanelRef,
            plainRef: plainPanelRef,
            escapeClipping,
            ariaLabel,
            className: panelClass,
            onKeyDown: handlePanelKeyDown,
          }}
        >
          {children}
        </PopoverPanel>
      ) : null}
    </div>
  )
}
