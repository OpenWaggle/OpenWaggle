import { ConversationId, type SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { resolveSessionStatusPill, TERMINAL_STATUSES } from '@shared/types/session-status'
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
import { WaggleBeeIcon } from '@/components/icons/waggle-bee-icon'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { cn } from '@/lib/cn'
import { formatRelativeTime, truncate } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useSessionStatusStore } from '@/stores/session-status-store'

const TITLE_TRUNCATE_LENGTH = 29
const ITEM_VARIANT_CLASS = {
  project: 'pl-8 pr-3',
  root: 'pl-4 pr-3',
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  GitCompareArrows,
  Loader2,
  CircleCheck,
  CirclePause,
  MessageCircle,
  ClipboardList,
  XCircle,
  WaggleBee: WaggleBeeIcon,
}

type SessionListItemVariant = 'project' | 'root'

interface SessionListItemProps {
  readonly session: SessionSummary
  readonly isActive: boolean
  readonly variant?: SessionListItemVariant
  readonly onSelect: (id: ConversationId) => void
  readonly onDelete: (id: ConversationId) => void
  readonly onMarkUnread: (id: ConversationId) => void
}

function sessionConversationId(sessionId: SessionId): ConversationId {
  return ConversationId(String(sessionId))
}

export function SessionListItem({
  session,
  isActive,
  variant = 'root',
  onSelect,
  onDelete,
  onMarkUnread,
}: SessionListItemProps) {
  const conversationId = sessionConversationId(session.id)
  const status = useSessionStatusStore((s) => s.statuses.get(conversationId) ?? 'idle')
  const completedAt = useSessionStatusStore((s) => s.completedAt.get(conversationId))
  const lastVisited = useSessionStatusStore((s) => s.lastVisitedAt.get(conversationId))

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })

  const isTerminal = TERMINAL_STATUSES.has(status)
  const isSeen =
    isTerminal &&
    completedAt !== undefined &&
    lastVisited !== undefined &&
    completedAt <= lastVisited
  const visibleStatus = isSeen ? 'idle' : status

  const pill = resolveSessionStatusPill(visibleStatus)
  const StatusIcon = pill ? ICON_MAP[pill.icon] : null
  const canMarkUnread = isSeen
  const hasMenuItems = canMarkUnread || !isActive

  function handleContextMenu(e: React.MouseEvent): void {
    if (!hasMenuItems) {
      return
    }
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuOpen(true)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: contextmenu is a native browser interaction on divs
    <div
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        'group mx-2 flex h-[34px] items-center rounded-md',
        ITEM_VARIANT_CLASS[variant],
        isActive ? 'bg-bg-active' : 'hover:bg-bg-hover',
      )}
      onContextMenu={handleContextMenu}
    >
      {pill && StatusIcon ? (
        <span className="mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <StatusIcon className={cn('h-3.5 w-3.5', pill.colorClass, pill.animateClass)} />
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => onSelect(conversationId)}
        className="min-w-0 flex-1 truncate text-left"
      >
        <span
          className={cn(
            'truncate text-[12px]',
            isActive ? 'font-medium text-text-primary' : 'text-text-secondary',
          )}
        >
          {truncate(session.title, TITLE_TRUNCATE_LENGTH)}
        </span>
      </button>
      <span className="ml-auto shrink-0 text-[11px] text-text-tertiary">
        {formatRelativeTime(session.updatedAt)}
      </span>

      <ContextMenu open={menuOpen} onClose={() => setMenuOpen(false)} position={menuPos}>
        {canMarkUnread && (
          <button
            type="button"
            onClick={() => {
              onMarkUnread(conversationId)
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
                .showConfirm('Delete this session?', 'This cannot be undone.')
                .then((confirmed) => {
                  if (confirmed) {
                    onDelete(conversationId)
                  }
                })
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-error"
          >
            <Trash2 className="h-3 w-3 shrink-0" />
            <span>Delete session</span>
          </button>
        )}
      </ContextMenu>
    </div>
  )
}
