import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { resolveSessionStatusPill, TERMINAL_STATUSES } from '@shared/types/session-status'
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CirclePause,
  ClipboardList,
  Copy,
  Eye,
  GitCompareArrows,
  Loader2,
  MessageCircle,
  MoreHorizontal,
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
type SessionItemStatusIcon = React.ComponentType<{ className?: string }>

interface SessionListItemProps {
  readonly session: SessionSummary
  readonly isActive: boolean
  readonly variant?: SessionListItemVariant
  readonly onSelect: (id: SessionId) => void
  readonly onDelete: (id: SessionId) => void
  readonly onArchive: (id: SessionId) => void
  readonly onMarkUnread: (id: SessionId) => void
  readonly onClone: (id: SessionId) => void
  readonly hasBranchDisclosure?: boolean
  readonly branchesCollapsed?: boolean
  readonly onToggleBranches?: () => void
}

function toSessionId(sessionId: SessionId): SessionId {
  return SessionId(String(sessionId))
}

function BranchDisclosureButton({
  visible,
  collapsed,
  onToggle,
}: {
  readonly visible: boolean
  readonly collapsed: boolean
  readonly onToggle?: () => void
}) {
  if (!visible) {
    return null
  }

  const DisclosureIcon = collapsed ? ChevronRight : ChevronDown

  return (
    <button
      type="button"
      aria-label={collapsed ? 'Expand branches' : 'Collapse branches'}
      onClick={(event) => {
        event.stopPropagation()
        onToggle?.()
      }}
      className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
    >
      <DisclosureIcon className="h-3 w-3" />
    </button>
  )
}

function SessionStatusMarkers({
  pill,
  StatusIcon,
  hasInterruptedRun,
}: {
  readonly pill: ReturnType<typeof resolveSessionStatusPill>
  readonly StatusIcon: SessionItemStatusIcon | null
  readonly hasInterruptedRun: boolean
}) {
  return (
    <>
      {pill && StatusIcon ? (
        <span className="mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <StatusIcon className={cn('h-3.5 w-3.5', pill.colorClass, pill.animateClass)} />
        </span>
      ) : null}
      {hasInterruptedRun ? (
        <span
          className="mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-amber-400"
          title="A run was interrupted in this session"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </>
  )
}

function SessionItemContextMenu({
  open,
  position,
  sessionId,
  onClose,
  onMarkUnread,
  onClone,
  onArchive,
  onDelete,
}: {
  readonly open: boolean
  readonly position: { readonly x: number; readonly y: number }
  readonly sessionId: SessionId
  readonly onClose: () => void
  readonly onMarkUnread: (id: SessionId) => void
  readonly onClone: (id: SessionId) => void
  readonly onArchive: (id: SessionId) => void
  readonly onDelete: (id: SessionId) => void
}) {
  function closeAfter(action: () => void): void {
    action()
    onClose()
  }

  function confirmDelete(): void {
    onClose()
    void api.showConfirm('Delete this session?', 'This cannot be undone.').then((confirmed) => {
      if (confirmed) {
        onDelete(sessionId)
      }
    })
  }

  return (
    <ContextMenu open={open} onClose={onClose} position={position}>
      <button
        type="button"
        onClick={() => closeAfter(() => onMarkUnread(sessionId))}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
      >
        <Eye className="h-3 w-3 shrink-0" />
        <span>Mark as unread</span>
      </button>
      <button
        type="button"
        onClick={() => closeAfter(() => onClone(sessionId))}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
      >
        <Copy className="h-3 w-3 shrink-0" />
        <span>Clone to new session</span>
      </button>
      <button
        type="button"
        onClick={() => closeAfter(() => onArchive(sessionId))}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
      >
        <Archive className="h-3 w-3 shrink-0" />
        <span>Archive session</span>
      </button>
      <button
        type="button"
        onClick={confirmDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-error"
      >
        <Trash2 className="h-3 w-3 shrink-0" />
        <span>Delete session</span>
      </button>
    </ContextMenu>
  )
}

function useSessionItemStatus(sessionId: SessionId, session: SessionSummary) {
  const status = useSessionStatusStore((s) => s.statuses.get(sessionId) ?? 'idle')
  const completedAt = useSessionStatusStore((s) => s.completedAt.get(sessionId))
  const lastVisited = useSessionStatusStore((s) => s.lastVisitedAt.get(sessionId))
  const isTerminal = TERMINAL_STATUSES.has(status)
  const isSeen =
    isTerminal &&
    completedAt !== undefined &&
    lastVisited !== undefined &&
    completedAt <= lastVisited
  const visibleStatus = isSeen ? 'idle' : status
  const pill = resolveSessionStatusPill(visibleStatus)

  return {
    pill,
    StatusIcon: pill ? ICON_MAP[pill.icon] : null,
    hasInterruptedRun: session.branches?.some((branch) => branch.interruptedRun) ?? false,
  }
}

export function SessionListItem({
  session,
  isActive,
  variant = 'root',
  onSelect,
  onDelete,
  onArchive,
  onMarkUnread,
  onClone,
  hasBranchDisclosure = false,
  branchesCollapsed = false,
  onToggleBranches,
}: SessionListItemProps) {
  const sessionId = toSessionId(session.id)
  const { pill, StatusIcon, hasInterruptedRun } = useSessionItemStatus(sessionId, session)

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuOpen(true)
  }

  function handleActionsClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuPos({ x: rect.left, y: rect.bottom })
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
      <BranchDisclosureButton
        visible={hasBranchDisclosure}
        collapsed={branchesCollapsed}
        onToggle={onToggleBranches}
      />
      <SessionStatusMarkers
        pill={pill}
        StatusIcon={StatusIcon}
        hasInterruptedRun={hasInterruptedRun}
      />
      <button
        type="button"
        onClick={() => onSelect(sessionId)}
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
      <div className="relative ml-auto h-5 w-14 shrink-0">
        <button
          type="button"
          aria-label={`Open session actions for ${session.title}`}
          onClick={handleActionsClick}
          className={cn(
            'peer absolute inset-y-0 right-0 z-10 flex h-5 w-5 items-center justify-center rounded text-text-tertiary opacity-0 transition-[background-color,color,opacity] hover:bg-bg-hover hover:text-text-secondary group-hover:opacity-100 focus:opacity-100',
            menuOpen ? 'opacity-100' : null,
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        <span
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 flex items-center text-right text-[11px] text-text-tertiary transition-opacity group-hover:opacity-0 peer-focus:opacity-0',
            menuOpen ? 'opacity-0' : 'opacity-100',
          )}
        >
          {formatRelativeTime(session.updatedAt)}
        </span>
      </div>

      <SessionItemContextMenu
        open={menuOpen}
        position={menuPos}
        sessionId={sessionId}
        onClose={() => setMenuOpen(false)}
        onMarkUnread={onMarkUnread}
        onClone={onClone}
        onArchive={onArchive}
        onDelete={onDelete}
      />
    </div>
  )
}
