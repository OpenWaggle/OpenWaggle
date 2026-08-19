import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { useSessionRowStatus } from '../hooks/useSessionRowStatus'
import type { SidebarSessionActions } from '../model'
import { SessionItemContextMenu } from './SessionItemContextMenu'
import {
  type SessionBranchDisclosure,
  SessionBranchDisclosureButton,
  SessionRowGlyph,
  SessionRowMenuTrigger,
  SessionRowTitle,
} from './SessionRowParts'
import {
  SessionDragGripSlot,
  SessionPinButton,
  type SessionPinnedRowState,
} from './SessionRowPinControls'
import { SessionRowHoverActions, SessionRowSecondLine } from './SessionRowSecondLine'

/**
 * Left inset per variant, from the prototype: 24px under a project heading, 10px for a Pinned
 * row that has no heading to sit under.
 */
const ITEM_VARIANT_CLASS = {
  project: 'pl-6 pr-2',
  root: 'pl-2.5 pr-2',
}

type SessionListItemVariant = 'project' | 'root'

interface SessionListItemProps {
  readonly session: SessionSummary
  readonly isActive: boolean
  readonly variant?: SessionListItemVariant
  readonly actions: SidebarSessionActions
  readonly branchDisclosure?: SessionBranchDisclosure
  readonly isPinned?: boolean
  readonly pinnedRow?: SessionPinnedRowState
  /**
   * Extra props for the row element itself, so a caller can make the row a drag source
   * without wrapping it in another element. A wrapper would be invalid inside the list and
   * would put the drag handlers on a non-semantic node. `data-*` keys are allowed so a drag
   * source can expose its position for tests and QA selectors.
   */
  readonly rowProps?: React.LiHTMLAttributes<HTMLLIElement> & Record<`data-${string}`, unknown>
}

/** What a Pinned row adds to the second line, defaulted for rows inside a project group. */
function resolvePinnedMeta(pinnedRow: SessionPinnedRowState | undefined) {
  if (pinnedRow === undefined) {
    return { isPinnedRow: false, projectLabel: '', shortcutIndex: null, draggable: false }
  }
  return {
    isPinnedRow: true,
    projectLabel: pinnedRow.projectLabel,
    shortcutIndex: pinnedRow.shortcutIndex,
    draggable: pinnedRow.draggable,
  }
}

function useRowContextMenu() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })

  return {
    menuOpen,
    menuPos,
    close: () => setMenuOpen(false),
    openAtPointer(event: React.MouseEvent) {
      event.preventDefault()
      setMenuPos({ x: event.clientX, y: event.clientY })
      setMenuOpen(true)
    },
    openUnderButton(event: React.MouseEvent<HTMLButtonElement>) {
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      setMenuPos({ x: rect.left, y: rect.bottom })
      setMenuOpen(true)
    },
  }
}

/**
 * A session row: status glyph, then a title line and a detail line.
 *
 * Two lines rather than one because a single 34px line could not carry a readable title and
 * the session's state at the same time. The title had 91px at the old width, which truncated
 * most real names. It now has the row to itself, and everything else moved to line two.
 */
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
  const sessionId = SessionId(String(session.id))
  const status = useSessionRowStatus(sessionId, session)
  const menu = useRowContextMenu()
  const pinned = resolvePinnedMeta(pinnedRow)

  // A type annotation rather than an assertion: React's CSSProperties does not model custom
  // properties, and the row sets one so its glyph, label and border read the same value.
  const rowStyle: React.CSSProperties & { '--row-color': string } = {
    '--row-color': status.rowColorVar,
  }

  return (
    <li
      aria-current={isActive ? 'true' : undefined}
      data-qa="sidebar-session-row"
      {...rowProps}
      style={rowStyle}
      className={cn(
        'group relative flex min-h-[44px] w-full items-start gap-2 py-1.5',
        ITEM_VARIANT_CLASS[variant],
        isActive ? 'bg-bg-active' : 'hover:bg-bg-hover',
        // A row needing a human carries a leading border, so attention is never colour alone.
        status.isAttention ? 'shadow-[inset_2px_0_0_var(--row-color)]' : null,
        rowProps?.className,
      )}
      onContextMenu={menu.openAtPointer}
    >
      <SessionBranchDisclosureButton disclosure={branchDisclosure} />
      {pinned.isPinnedRow ? <SessionDragGripSlot draggable={pinned.draggable} /> : null}
      <SessionRowGlyph
        StatusIcon={status.StatusIcon}
        animateClass={status.animateClass}
        hasInterruptedRun={status.hasInterruptedRun}
      />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <SessionRowTitle
          isActive={isActive}
          isInFlight={status.isInFlight}
          session={session}
          onSelect={() => actions.select(sessionId)}
        />
        <SessionRowSecondLine
          session={session}
          stateLabel={status.stateLabel}
          stateColorVar={status.stateColorVar}
          phaseLabel={status.isInFlight ? status.phase : null}
          projectLabel={pinned.projectLabel}
          shortcutIndex={pinned.shortcutIndex}
        />
      </span>

      <SessionRowHoverActions isActive={isActive} menuOpen={menu.menuOpen}>
        <SessionPinButton
          isPinned={isPinned}
          session={session}
          onClick={(event) => {
            event.stopPropagation()
            actions.togglePin(sessionId)
          }}
        />
        <SessionRowMenuTrigger session={session} onClick={menu.openUnderButton} />
      </SessionRowHoverActions>

      <SessionItemContextMenu
        open={menu.menuOpen}
        position={menu.menuPos}
        sessionId={sessionId}
        isPinned={isPinned}
        actions={actions}
        onClose={menu.close}
      />
    </li>
  )
}
