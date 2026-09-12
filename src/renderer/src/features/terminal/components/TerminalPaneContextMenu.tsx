import { ClipboardPaste, Copy, MessageSquarePlus } from 'lucide-react'
import { useRef } from 'react'
import { useMenuKeyboard } from '@/shared/hooks/useMenuKeyboard'
import { Button } from '@/shared/ui/Button'
import { ContextMenu } from '@/shared/ui/ContextMenu'

interface TerminalPaneContextMenuProps {
  readonly open: boolean
  readonly position: { readonly x: number; readonly y: number }
  readonly hasSelection: boolean
  readonly onAddToChat: () => void
  readonly onCopy: () => void
  readonly onPaste: () => void
  readonly onClose: () => void
}

function MenuButton(props: {
  readonly label: string
  readonly icon: typeof Copy
  readonly disabled?: boolean
  readonly onSelect: () => void
}) {
  const Icon = props.icon
  return (
    <Button
      type="button"
      role="menuitem"
      tabIndex={-1}
      variant="unstyled"
      disabled={props.disabled}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-default disabled:opacity-40"
      onClick={props.onSelect}
    >
      <Icon className="size-3.5 shrink-0" />
      <span>{props.label}</span>
    </Button>
  )
}

/** Pointer and keyboard context actions matching a native terminal's core menu. */
export function TerminalPaneContextMenu(props: TerminalPaneContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const handleKeyDown = useMenuKeyboard({
    enabled: true,
    isOpen: props.open,
    panelRef: menuRef,
    onClose: props.onClose,
  })
  const select = (action: () => void) => {
    props.onClose()
    action()
  }

  return (
    <ContextMenu open={props.open} onClose={props.onClose} position={props.position}>
      <div ref={menuRef} role="menu" aria-label="Terminal actions" onKeyDown={handleKeyDown}>
        <MenuButton
          icon={MessageSquarePlus}
          label="Add selection to chat"
          disabled={!props.hasSelection}
          onSelect={() => select(props.onAddToChat)}
        />
        <MenuButton
          icon={Copy}
          label="Copy"
          disabled={!props.hasSelection}
          onSelect={() => select(props.onCopy)}
        />
        <MenuButton icon={ClipboardPaste} label="Paste" onSelect={() => select(props.onPaste)} />
      </div>
    </ContextMenu>
  )
}
