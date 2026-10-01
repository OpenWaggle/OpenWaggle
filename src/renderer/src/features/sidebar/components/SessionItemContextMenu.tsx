import type { SessionId } from '@shared/types/brand'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Copy,
  Edit3,
  Eye,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useSessionTitleRegeneration } from '@/features/session-title'
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
  readonly commands: SessionRowMenuCommands
  readonly onClose: () => void
}

/** Commands that act on this row rather than on the Session alone. */
export interface SessionRowMenuCommands {
  /** Put the row's title into its inline rename field. */
  readonly rename: () => void
  /**
   * Keyboard route for reordering a pinned row, null when the move does not apply.
   *
   * Dragging is the only pointer route for Manual order, and dragging alone fails WCAG 2.2
   * SC 2.1.1 Keyboard and SC 2.5.7 Dragging Movements. This menu opens from the keyboard, so these
   * give reordering a route that needs no sustained gesture.
   */
  readonly moveUp?: (() => void) | null
  readonly moveDown?: (() => void) | null
}

function SessionMenuButton({
  icon: Icon,
  label,
  danger = false,
  disabled = false,
  onClick,
}: {
  readonly icon: typeof Eye
  readonly label: string
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-hover disabled:cursor-default disabled:opacity-60${danger ? ' hover:text-error' : ''}`}
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
  commands,
  onClose,
}: SessionItemContextMenuProps) {
  const { moveUp, moveDown } = commands
  const titleRegeneration = useSessionTitleRegeneration(sessionId)

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
      {moveUp ? (
        <SessionMenuButton icon={ArrowUp} label="Move up" onClick={() => closeAfter(moveUp)} />
      ) : null}
      {moveDown ? (
        <SessionMenuButton
          icon={ArrowDown}
          label="Move down"
          onClick={() => closeAfter(moveDown)}
        />
      ) : null}
      <SessionMenuButton
        icon={Edit3}
        label="Rename session"
        onClick={() => closeAfter(commands.rename)}
      />
      {titleRegeneration.available ? (
        <SessionMenuButton
          icon={Sparkles}
          label={titleRegeneration.isRegenerating ? 'Regenerating title…' : 'Regenerate title'}
          disabled={titleRegeneration.isRegenerating}
          onClick={() => closeAfter(titleRegeneration.regenerate)}
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
