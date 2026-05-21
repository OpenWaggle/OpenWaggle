import type { SessionId } from '@shared/types/brand'
import { Archive, Copy, Eye, Trash2 } from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { ContextMenu } from '@/shared/ui/ContextMenu'

interface SessionItemContextMenuProps {
  readonly open: boolean
  readonly position: { readonly x: number; readonly y: number }
  readonly sessionId: SessionId
  readonly onClose: () => void
  readonly onMarkUnread: (id: SessionId) => void
  readonly onClone: (id: SessionId) => void
  readonly onArchive: (id: SessionId) => void
  readonly onDelete: (id: SessionId) => void
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
  onClose,
  onMarkUnread,
  onClone,
  onArchive,
  onDelete,
}: SessionItemContextMenuProps) {
  function closeAfter(action: () => void) {
    action()
    onClose()
  }

  function confirmDelete() {
    onClose()
    void api.showConfirm('Delete this session?', 'This cannot be undone.').then((confirmed) => {
      if (confirmed) onDelete(sessionId)
    })
  }

  return (
    <ContextMenu open={open} onClose={onClose} position={position}>
      <SessionMenuButton
        icon={Eye}
        label="Mark as unread"
        onClick={() => closeAfter(() => onMarkUnread(sessionId))}
      />
      <SessionMenuButton
        icon={Copy}
        label="Clone to new session"
        onClick={() => closeAfter(() => onClone(sessionId))}
      />
      <SessionMenuButton
        icon={Archive}
        label="Archive session"
        onClick={() => closeAfter(() => onArchive(sessionId))}
      />
      <SessionMenuButton icon={Trash2} label="Delete session" danger onClick={confirmDelete} />
    </ContextMenu>
  )
}
