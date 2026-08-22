import type { SessionId } from '@shared/types/brand'
import { Archive, ArrowDown, ArrowUp, Copy, Eye, Pin, PinOff, Trash2 } from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { ContextMenu } from '@/shared/ui/ContextMenu'
import type { SidebarSessionActions } from '../model'

interface SessionItemContextMenuProps {
  readonly open: boolean
  readonly position: { readonly x: number; readonly y: number }
  readonly sessionId: SessionId
  readonly isPinned: boolean
  readonly actions: SidebarSessionActions
  /**
   * Keyboard route for reordering a pinned row, null when the move does not apply.
   *
   * Dragging is the only pointer route for Manual order, and dragging alone fails WCAG 2.2
   * SC 2.1.1 Keyboard and SC 2.5.7 Dragging Movements. This menu opens from the keyboard, so these
   * give reordering a route that needs no sustained gesture.
   */
  readonly onMoveUp?: (() => void) | null
  readonly onMoveDown?: (() => void) | null
  readonly onClose: () => void
}

function SessionMenuButton({
  icon: Icon,
  label,
  danger = false,
  onClick,
}: {
  readonly icon: typeof Eye
  readonly label: string
  readonly danger?: boolean
  readonly onClick: () => void
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover${danger ? ' hover:text-error' : ''}`}
    >
      <Icon className="size-3 shrink-0" />
      <span>{label}</span>
    </Button>
  )
}

export function SessionItemContextMenu({
  open,
  position,
  sessionId,
  isPinned,
  actions,
  onMoveUp,
  onMoveDown,
  onClose,
}: SessionItemContextMenuProps) {
  function closeAfter(action: () => void) {
    action()
    onClose()
  }

  function confirmDelete() {
    onClose()
    void api.showConfirm('Delete this session?', 'This cannot be undone.').then((confirmed) => {
      if (confirmed) actions.delete(sessionId)
    })
  }

  return (
    <ContextMenu open={open} onClose={onClose} position={position}>
      <SessionMenuButton
        icon={isPinned ? PinOff : Pin}
        label={isPinned ? 'Unpin session' : 'Pin session'}
        onClick={() => closeAfter(() => actions.togglePin(sessionId))}
      />
      {onMoveUp ? (
        <SessionMenuButton icon={ArrowUp} label="Move up" onClick={() => closeAfter(onMoveUp)} />
      ) : null}
      {onMoveDown ? (
        <SessionMenuButton
          icon={ArrowDown}
          label="Move down"
          onClick={() => closeAfter(onMoveDown)}
        />
      ) : null}
      <SessionMenuButton
        icon={Eye}
        label="Mark as unread"
        onClick={() => closeAfter(() => actions.markUnread(sessionId))}
      />
      <SessionMenuButton
        icon={Copy}
        label="Clone to new session"
        onClick={() => closeAfter(() => actions.clone(sessionId))}
      />
      <SessionMenuButton
        icon={Archive}
        label="Archive session"
        onClick={() => closeAfter(() => actions.archive(sessionId))}
      />
      <SessionMenuButton icon={Trash2} label="Delete session" danger onClick={confirmDelete} />
    </ContextMenu>
  )
}
