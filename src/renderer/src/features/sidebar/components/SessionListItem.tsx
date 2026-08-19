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
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useSessionStatusStore } from '@/features/sessions/state'
import { WaggleBeeIcon } from '@/features/waggle/components'
import { cn } from '@/shared/lib/cn'
import { truncate } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import type { SidebarSessionActions } from '../model'
import { SessionItemContextMenu } from './SessionItemContextMenu'
import { SessionRowActions } from './SessionRowActions'
import { SessionGitBadge } from './SessionRowGitBadge'
import {
  SessionDragGripSlot,
  SessionPinnedRowMeta,
  type SessionPinnedRowState,
} from './SessionRowPinControls'

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
  readonly onToggle?: (() => void) | undefined
}

interface SessionListItemProps {
  readonly session: SessionSummary
  readonly isActive: boolean
  readonly variant?: SessionListItemVariant
  readonly actions: SidebarSessionActions
  readonly branchDisclosure?: SessionBranchDisclosureState
  readonly isPinned?: boolean
  readonly pinnedRow?: SessionPinnedRowState
  /**
   * Extra props for the row element itself, so a caller can make the row a drag source
   * without wrapping it in another element — a wrapper would be invalid inside the list
   * and would put the drag handlers on a non-semantic node. `data-*` keys are allowed so
   * a drag source can expose its position for tests and QA selectors.
   */
  readonly rowProps?: React.LiHTMLAttributes<HTMLLIElement> & Record<`data-${string}`, unknown>
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
  readonly onToggle?: (() => void) | undefined
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
    StatusIcon: pill ? (ICON_MAP[pill.icon] ?? null) : null,
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
      className="min-w-0 flex-[2_1_0%] truncate text-left"
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

export function SessionListItem({
  session,
  isActive,
  variant = 'root',
  actions,
  branchDisclosure,
  isPinned = false,
  pinnedRow,
  rowProps,
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
      {...rowProps}
      className={cn(
        'group mx-2 flex h-[34px] items-center rounded-md',
        ITEM_VARIANT_CLASS[variant],
        isActive ? 'bg-bg-active' : 'hover:bg-bg-hover',
        rowProps?.className,
      )}
      onContextMenu={handleContextMenu}
    >
      <BranchDisclosureButton
        visible={branchDisclosure?.visible ?? false}
        collapsed={branchDisclosure?.collapsed ?? false}
        onToggle={branchDisclosure?.onToggle}
      />
      {pinnedRow ? <SessionDragGripSlot draggable={pinnedRow.draggable} /> : null}
      <SessionStatusMarkers
        pill={pill}
        StatusIcon={StatusIcon}
        hasInterruptedRun={hasInterruptedRun}
      />
      <SessionGitBadge session={session} />
      <SessionTitleButton
        isActive={isActive}
        session={session}
        sessionId={sessionId}
        onSelect={actions.select}
      />
      {pinnedRow ? <SessionPinnedRowMeta pinnedRow={pinnedRow} /> : null}
      <SessionRowActions
        isPinned={isPinned}
        menuOpen={menuOpen}
        session={session}
        showTimestamp={!pinnedRow}
        onActionsClick={handleActionsClick}
        onTogglePin={() => actions.togglePin(sessionId)}
      />

      <SessionItemContextMenu
        open={menuOpen}
        position={menuPos}
        sessionId={sessionId}
        isPinned={isPinned}
        actions={actions}
        onClose={() => setMenuOpen(false)}
      />
    </li>
  )
}
