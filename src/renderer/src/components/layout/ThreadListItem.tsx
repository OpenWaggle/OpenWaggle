import type { ConversationId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import { resolveThreadStatusPill, TERMINAL_STATUSES } from '@shared/types/thread-status'
import {
  CircleCheck,
  CirclePause,
  ClipboardList,
  Eye,
  GitCompareArrows,
  Loader2,
  MessageCircle,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { cn } from '@/lib/cn'
import { formatRelativeTime, truncate } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useThreadStatusStore } from '@/stores/thread-status-store'

const TRUNCATE_ARG_2 = 29

const ICON_MAP: Record<string, typeof Loader2> = {
  GitCompareArrows,
  Loader2,
  CircleCheck,
  CirclePause,
  MessageCircle,
  ClipboardList,
  XCircle,
}

interface ThreadListItemProps {
  readonly conversation: ConversationSummary
  readonly isActive: boolean
  readonly onSelect: (id: ConversationId) => void
  readonly onDelete: (id: ConversationId) => void
  readonly onMarkUnread: (id: ConversationId) => void
}

export function ThreadListItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
  onMarkUnread,
}: ThreadListItemProps): React.JSX.Element {
  const status = useThreadStatusStore((s) => s.statuses.get(conversation.id) ?? 'idle')
  const completedAt = useThreadStatusStore((s) => s.completedAt.get(conversation.id))
  const lastVisited = useThreadStatusStore((s) => s.lastVisitedAt.get(conversation.id))

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })

  // Determine visible status: suppress terminal icons that have been seen
  const isTerminal = TERMINAL_STATUSES.has(status)
  const isSeen =
    isTerminal &&
    completedAt !== undefined &&
    lastVisited !== undefined &&
    completedAt <= lastVisited
  const visibleStatus = isSeen ? 'idle' : status

  const pill = resolveThreadStatusPill(visibleStatus)
  const StatusIcon = pill ? ICON_MAP[pill.icon] : null

  // "Mark as unread" is only available for seen terminal statuses
  const canMarkUnread = isSeen
  const hasMenuItems = canMarkUnread || !isActive

  function handleContextMenu(e: React.MouseEvent): void {
    if (!hasMenuItems) return
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuOpen(true)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: contextmenu is a native browser interaction on divs
    <div
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        'group flex items-center h-[34px] w-full pl-3 pr-3',
        isActive ? 'bg-bg-active border-l-2 border-accent' : 'hover:bg-bg-hover',
      )}
      onContextMenu={handleContextMenu}
    >
      {/* Status icon slot — always reserved so title never shifts */}
      <span className="mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {pill && StatusIcon && (
          <StatusIcon className={cn('h-3.5 w-3.5', pill.colorClass, pill.animateClass)} />
        )}
      </span>
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        className="min-w-0 flex-1 truncate text-left"
      >
        <span
          className={cn(
            'truncate text-[12px]',
            isActive ? 'font-medium text-text-primary' : 'text-text-secondary',
          )}
        >
          {truncate(conversation.title, TRUNCATE_ARG_2)}
        </span>
      </button>
      <span className="ml-auto shrink-0 text-[11px] text-text-tertiary">
        {formatRelativeTime(conversation.updatedAt)}
      </span>

      {/* Right-click context menu */}
      <ContextMenu open={menuOpen} onClose={() => setMenuOpen(false)} position={menuPos}>
        {canMarkUnread && (
          <button
            type="button"
            onClick={() => {
              onMarkUnread(conversation.id)
              setMenuOpen(false)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
          >
            <Eye className="h-3 w-3 shrink-0" />
            <span>Mark as unread</span>
          </button>
        )}
        {!isActive && (
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              void api
                .showConfirm('Delete this thread?', 'This cannot be undone.')
                .then((confirmed) => {
                  if (confirmed) onDelete(conversation.id)
                })
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-error"
          >
            <Trash2 className="h-3 w-3 shrink-0" />
            <span>Delete thread</span>
          </button>
        )}
      </ContextMenu>
    </div>
  )
}
