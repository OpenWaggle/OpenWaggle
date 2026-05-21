import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { resolveSessionStatusPill, TERMINAL_STATUSES } from '@shared/types/session-status'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CirclePause,
  ClipboardList,
  GitCompareArrows,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useSessionStatusStore } from '@/features/sessions/state'
import { WaggleBeeIcon } from '@/features/waggle/components'
import { cn } from '@/shared/lib/cn'
import { formatRelativeTime, truncate } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import type { SidebarSessionActions } from '../model'
import { SessionItemContextMenu } from './SessionItemContextMenu'

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

interface SessionBranchDisclosureState {
  readonly visible: boolean
  readonly collapsed: boolean
  readonly onToggle?: () => void
}

interface SessionListItemProps {
  readonly session: SessionSummary
  readonly isActive: boolean
  readonly variant?: SessionListItemVariant
  readonly actions: SidebarSessionActions
  readonly branchDisclosure?: SessionBranchDisclosureState
}

function toSessionId(sessionId: SessionId) {
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
    <Button
      variant="unstyled"
      type="button"
      aria-label={collapsed ? 'Expand branches' : 'Collapse branches'}
      onClick={(event) => {
        event.stopPropagation()
        onToggle?.()
      }}
      className="mr-1 flex size-4 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
    >
      <DisclosureIcon className="size-3" />
    </Button>
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
        <span className="mr-2 flex size-3.5 shrink-0 items-center justify-center">
          <StatusIcon className={cn('size-3.5', pill.colorClass, pill.animateClass)} />
        </span>
      ) : null}
      {hasInterruptedRun ? (
        <span
          className="mr-2 flex size-3.5 shrink-0 items-center justify-center text-amber-400"
          title="A run was interrupted in this session"
        >
          <AlertTriangle className="size-3.5" />
        </span>
      ) : null}
    </>
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

function SessionTitleButton({
  isActive,
  session,
  sessionId,
  onSelect,
}: {
  readonly isActive: boolean
  readonly session: SessionSummary
  readonly sessionId: SessionId
  readonly onSelect: (id: SessionId) => void
}) {
  return (
    <Button
      variant="unstyled"
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
    </Button>
  )
}

function SessionActionsTrigger({
  menuOpen,
  session,
  onClick,
}: {
  readonly menuOpen: boolean
  readonly session: SessionSummary
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <div className="relative ml-auto h-5 w-14 shrink-0">
      <Button
        variant="unstyled"
        type="button"
        aria-label={`Open session actions for ${session.title}`}
        onClick={onClick}
        className={cn(
          'peer absolute inset-y-0 right-0 z-10 flex size-5 items-center justify-center rounded text-text-tertiary opacity-0 transition-[background-color,color,opacity] hover:bg-bg-hover hover:text-text-secondary group-hover:opacity-100 focus:opacity-100',
          menuOpen ? 'opacity-100' : null,
        )}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      <span
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 flex items-center text-right text-[11px] text-text-tertiary transition-opacity group-hover:opacity-0 peer-focus:opacity-0',
          menuOpen ? 'opacity-0' : 'opacity-100',
        )}
      >
        {formatRelativeTime(session.updatedAt)}
      </span>
    </div>
  )
}

export function SessionListItem({
  session,
  isActive,
  variant = 'root',
  actions,
  branchDisclosure,
}: SessionListItemProps) {
  const sessionId = toSessionId(session.id)
  const { pill, StatusIcon, hasInterruptedRun } = useSessionItemStatus(sessionId, session)

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuOpen(true)
  }

  function handleActionsClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuPos({ x: rect.left, y: rect.bottom })
    setMenuOpen(true)
  }

  return (
    <li
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        'group mx-2 flex h-[34px] items-center rounded-md',
        ITEM_VARIANT_CLASS[variant],
        isActive ? 'bg-bg-active' : 'hover:bg-bg-hover',
      )}
      onContextMenu={handleContextMenu}
    >
      <BranchDisclosureButton
        visible={branchDisclosure?.visible ?? false}
        collapsed={branchDisclosure?.collapsed ?? false}
        onToggle={branchDisclosure?.onToggle}
      />
      <SessionStatusMarkers
        pill={pill}
        StatusIcon={StatusIcon}
        hasInterruptedRun={hasInterruptedRun}
      />
      <SessionTitleButton
        isActive={isActive}
        session={session}
        sessionId={sessionId}
        onSelect={actions.select}
      />
      <SessionActionsTrigger menuOpen={menuOpen} session={session} onClick={handleActionsClick} />

      <SessionItemContextMenu
        open={menuOpen}
        position={menuPos}
        sessionId={sessionId}
        onClose={() => setMenuOpen(false)}
        onMarkUnread={actions.markUnread}
        onClone={actions.clone}
        onArchive={actions.archive}
        onDelete={actions.delete}
      />
    </li>
  )
}
