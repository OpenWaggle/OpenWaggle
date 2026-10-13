import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useState } from 'react'
import { useSessionTitleRename } from '@/features/session-title'
import { cn } from '@/shared/lib/cn'
import { useSessionRowDescription } from '../hooks/useSessionRowDescription'
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

/** How a sidebar row is emphasized (ADR 0050). */
export type SessionRowHighlight = 'active' | 'hive-home' | 'none'

const HIVE_HOME_ROW_CLASS = 'bg-bg-active ring-1 ring-accent/40 ring-inset'
const HIVE_HOME_TITLE = 'A Worker of this Queen’s Hive is open'

/**
 * The row element's presentation for a highlight: background class, hover title and QA hook.
 * The open row keeps `aria-current`; the Hive home does not, because it is not the open Session.
 */
function sessionRowPresentation(highlight: SessionRowHighlight, rowDescription: string) {
  if (highlight === 'hive-home') {
    return {
      className: HIVE_HOME_ROW_CLASS,
      title: rowDescription === '' ? HIVE_HOME_TITLE : `${rowDescription} — ${HIVE_HOME_TITLE}`,
      testId: 'sidebar-session-row-hive-home',
    }
  }
  return {
    className: highlight === 'active' ? 'bg-bg-active' : 'hover:bg-bg-hover',
    title: rowDescription,
    testId: 'sidebar-session-row',
  }
}

interface SessionListItemProps {
  readonly session: SessionSummary
  /**
   * How the row is highlighted: the open Session ('active'), the Queen whose Hive the open
   * Worker belongs to ('hive-home', a secondary highlight so the Hive's context stays visible
   * without being mistaken for the open row, ADR 0050), or neither.
   */
  readonly highlight?: SessionRowHighlight
  readonly variant?: SessionListItemVariant
  readonly actions: SidebarSessionActions
  readonly branchDisclosure?: SessionBranchDisclosure
  readonly isPinned?: boolean
  readonly pinnedRow?: SessionPinnedRowState
  /** How many of this Queen's hidden Workers need the user (ADR 0050); Queen rows only. */
  readonly workerAttentionCount?: number
  /** Name the Worker's parent on line two: pinned rows always, narrowed rows for flat Workers. */
  readonly showLineageParent?: boolean
  /**
   * Extra props for the row element itself, so a caller can make the row a drag source
   * without wrapping it in another element. A wrapper would be invalid inside the list and
   * would put the drag handlers on a non-semantic node. `data-*` keys are allowed so a drag
   * source can expose its position for tests and QA selectors.
   */
  readonly rowProps?: React.LiHTMLAttributes<HTMLLIElement> & Record<`data-${string}`, unknown>
}

/**
 * The Hive metadata a row's second line carries (ADR 0050).
 *
 * A Pinned Worker row always names its parent; a narrowed project row names it so a flat Worker
 * is never mistaken for an ordinary session.
 */
function resolveHiveRowMeta(input: {
  readonly session: SessionSummary
  readonly isPinnedRow: boolean
  readonly workerAttentionCount: number
  readonly showLineageParent: boolean
}) {
  return {
    workerAttentionCount: input.workerAttentionCount,
    showParent:
      input.showLineageParent || (input.isPinnedRow && input.session.lineage?.role === 'worker'),
  }
}

/** What a Pinned row adds to the second line, defaulted for rows inside a project group. */
function resolvePinnedMeta(pinnedRow: SessionPinnedRowState | undefined) {
  if (pinnedRow === undefined) {
    return {
      isPinnedRow: false,
      projectLabel: '',
      shortcutIndex: null,
      draggable: false,
      onMoveUp: null,
      onMoveDown: null,
    }
  }
  return {
    isPinnedRow: true,
    projectLabel: pinnedRow.projectLabel,
    shortcutIndex: pinnedRow.shortcutIndex,
    draggable: pinnedRow.draggable,
    onMoveUp: pinnedRow.onMoveUp,
    onMoveDown: pinnedRow.onMoveDown,
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
  highlight = 'none',
  variant = 'root',
  actions,
  branchDisclosure,
  isPinned = false,
  pinnedRow,
  workerAttentionCount = 0,
  showLineageParent = false,
  rowProps,
}: SessionListItemProps) {
  const sessionId = SessionId(String(session.id))
  const status = useSessionRowStatus(sessionId, session)
  const menu = useRowContextMenu()
  const rename = useSessionTitleRename(sessionId, session.title)
  const pinned = resolvePinnedMeta(pinnedRow)
  const hiveMeta = resolveHiveRowMeta({
    session,
    isPinnedRow: pinned.isPinnedRow,
    workerAttentionCount,
    showLineageParent,
  })
  const rowDescription = useSessionRowDescription({
    session,
    projectLabel: pinned.projectLabel,
    stateLabel: status.stateLabel,
    hasInterruptedRun: status.hasInterruptedRun,
  })

  // A type annotation rather than an assertion: React's CSSProperties does not model custom
  // properties, and the row sets one so its glyph, label and border read the same value.
  const rowStyle: React.CSSProperties & { '--row-color': string } = {
    '--row-color': status.rowColorVar,
  }
  const presentation = sessionRowPresentation(highlight, rowDescription ?? '')
  const isActive = highlight === 'active'

  return (
    <li
      aria-current={isActive ? 'true' : undefined}
      /*
       * The row carries the hover description for everything inside it. The stretched click target
       * is hit-tested as part of the title control, so a title on an inner span is unreachable;
       * a title here is found by walking ancestors.
       */
      title={presentation.title}
      data-qa={presentation.testId}
      {...rowProps}
      // Selecting or dragging text inside the rename field must not start a pinned-row drag.
      {...(rename.isEditing ? { draggable: false } : {})}
      data-session-id={sessionId}
      style={rowStyle}
      className={cn(
        'group relative flex min-h-11 w-full items-start gap-2 py-1.5',
        ITEM_VARIANT_CLASS[variant],
        presentation.className,
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
          rename={rename}
          onSelect={() => actions.select(sessionId)}
        />
        <SessionRowSecondLine
          session={session}
          stateLabel={status.stateLabel}
          stateColorVar={status.stateColorVar}
          phaseLabel={status.isInFlight ? status.phase : null}
          projectLabel={pinned.projectLabel}
          shortcutIndex={pinned.shortcutIndex}
          workerAttentionCount={hiveMeta.workerAttentionCount}
          showLineageParent={hiveMeta.showParent}
        />
      </span>

      {/* The rename field spans the title line; its actions would sit under its text. */}
      {rename.isEditing ? null : (
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
      )}

      <SessionItemContextMenu
        open={menu.menuOpen}
        position={menu.menuPos}
        sessionId={sessionId}
        isPinned={isPinned}
        actions={actions}
        commands={{ rename: rename.start, moveUp: pinned.onMoveUp, moveDown: pinned.onMoveDown }}
        onClose={menu.close}
      />
    </li>
  )
}
