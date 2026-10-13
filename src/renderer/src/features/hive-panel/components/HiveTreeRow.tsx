import { SessionId } from '@shared/types/brand'
import { IDLE_ROW_COLOR_VAR, resolveSessionStatusPill } from '@shared/types/session-status'
import { ChessQueen, Pickaxe } from 'lucide-react'
import { useState } from 'react'
import { useSessionTitleRename } from '@/features/session-title'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { SessionItemContextMenu } from '@/features/sidebar/components'
import { usePinnedSessionsStore } from '@/features/sidebar/state'
import { useUnarchiveSessionMutation } from '@/queries/archived-sessions'
import { Button } from '@/shared/ui/Button'
import { useHivePanelSessionActions } from '../hooks/useHivePanelSessionActions'
import { type HiveTreeRow, hiveRowStateLabel } from '../lib/hive-tree-model'

/**
 * The Hive rows are a three-column table (ADR 0050 review): Session, Workspace, State — with one
 * column header over the whole list, so the trailing cells read as columns rather than stray
 * words. The header and every row share this grid; the Session column takes the rest. Inline
 * rather than Tailwind classes because the dev Tailwind source snapshot only regenerates on a
 * dev-server restart, and the columns must be tunable without one.
 */
/*
 * Rows reserve a right gutter (`pr-9`) for the ⋯ actions button, and the column header reserves the
 * same, so the right-aligned State column never runs under the button and nothing shifts when the
 * button appears on hover.
 */
export const HIVE_ROW_GRID_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 84px 72px',
  columnGap: '8px',
} as const satisfies React.CSSProperties

/** The row's ⋯ menu state and openers. */
function useRowMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  return {
    open,
    pos,
    close: () => setOpen(false),
    openAtPointer(event: React.MouseEvent) {
      event.preventDefault()
      setPos({ x: event.clientX, y: event.clientY })
      setOpen(true)
    },
    openUnderButton(event: React.MouseEvent<HTMLButtonElement>) {
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      setPos({ x: rect.left, y: rect.bottom })
      setOpen(true)
    },
  }
}

/**
 * One Hive panel row: state, Workspace placement, and the sidebar's own ⋯ menu (ADR 0050).
 *
 * The menu is the same `SessionItemContextMenu` the sidebar renders, registered by the Sidebar,
 * so every action behaves identically in both places. An archived row offers Restore instead of
 * Archive, and Move up / Move down stay Pinned-only.
 */
export function HiveTreeListItem({
  row,
  isCurrent,
  onOpen,
  isRoot = false,
}: {
  readonly row: HiveTreeRow
  readonly isCurrent: boolean
  readonly onOpen: () => void
  /** The hive root is the Queen even when it has no lineage row of its own (ADR 0030). */
  readonly isRoot?: boolean
}) {
  const session = row.session
  const sessionId = SessionId(String(session.id))
  const status = useSessionStatusStore((store) => store.statuses.get(sessionId) ?? 'idle')
  const statusView = resolveSessionStatusPill(status)
  const {
    short: stateShort,
    needsAttention,
    hint: stateHint,
  } = hiveRowStateLabel(session, statusView?.shortLabel ?? 'Idle')
  const menu = useRowMenu()
  const isPinned = usePinnedSessionsStore((store) =>
    store.pins.some((pin) => String(pin.sessionId) === String(sessionId)),
  )
  const { Icon, roleLabel } = isRoot
    ? { Icon: ChessQueen, roleLabel: 'Queen' }
    : hiveRolePresentation(session)
  const worktree = session.worktreePath ? lastSegment(session.worktreePath) : 'Checkout'

  return (
    <div className="group relative">
      <Button
        type="button"
        variant="unstyled"
        className="min-h-9 w-full items-center rounded-md py-1.5 pr-9 pl-2 text-left transition-colors group-hover:bg-bg-hover"
        style={HIVE_ROW_GRID_STYLE}
        aria-current={isCurrent ? 'true' : undefined}
        aria-label={`Open ${roleLabel} Session: ${session.title}`}
        onClick={onOpen}
        onContextMenu={menu.openAtPointer}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon
            aria-hidden="true"
            className={
              needsAttention
                ? 'size-3.5 shrink-0 text-warning'
                : 'size-3.5 shrink-0 text-text-tertiary'
            }
          />
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: statusView?.colorVar ?? IDLE_ROW_COLOR_VAR }}
          />
          <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
            {session.title}
            {row.via !== null ? <span className="text-text-tertiary"> · via {row.via}</span> : null}
          </span>
          {isPinned ? (
            <span className="shrink-0 rounded border border-border-light bg-bg-tertiary px-1 py-0.5 text-xs text-text-tertiary">
              Pinned
            </span>
          ) : null}
        </span>
        <span
          className="truncate text-right text-xs text-text-tertiary"
          title={
            session.worktreePath
              ? `Workspace: ${session.worktreePath}`
              : 'Workspace: the project checkout'
          }
        >
          {worktree}
        </span>
        <span
          className={
            needsAttention
              ? 'truncate text-right text-xs text-warning'
              : 'truncate text-right text-xs text-text-tertiary'
          }
          title={stateHint}
        >
          {stateShort}
        </span>
      </Button>
      <HiveRowMenu
        sessionId={sessionId}
        title={session.title}
        isPinned={isPinned}
        archived={session.archived === true}
        menu={menu}
      />
    </div>
  )
}

/** The row's ⋯ menu, hidden until a Sidebar has registered the shared session actions. */
function HiveRowMenu({
  sessionId,
  title,
  isPinned,
  archived,
  menu,
}: {
  readonly sessionId: SessionId
  readonly title: string
  readonly isPinned: boolean
  readonly archived: boolean
  readonly menu: ReturnType<typeof useRowMenu>
}) {
  const actions = useHivePanelSessionActions()
  const rename = useSessionTitleRename(sessionId, title)
  const unarchive = useUnarchiveSessionMutation()
  if (actions === null) return null

  function restore() {
    menu.close()
    void unarchive
      .mutateAsync(sessionId)
      .then(() => useSessionStore.getState().loadSessions())
      .catch(() => {
        // A failed restore leaves the row where it is; the row keeps offering Restore.
      })
  }
  return (
    <>
      <Button
        type="button"
        variant="unstyled"
        aria-label={`Open session actions for ${title}`}
        onClick={menu.openUnderButton}
        className="absolute top-1/2 right-1.5 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary group-hover:flex group-focus-within:flex"
      >
        ⋯
      </Button>
      <SessionItemContextMenu
        open={menu.open}
        position={menu.pos}
        sessionId={sessionId}
        isPinned={isPinned}
        actions={actions}
        archived={archived}
        commands={{ rename: rename.start, moveUp: null, moveDown: null, restore }}
        onClose={menu.close}
      />
    </>
  )
}

/** The row's role glyph and label, from the lineage role. */
function hiveRolePresentation(session: { readonly lineage?: { readonly role?: string } | null }) {
  const isQueen = session.lineage?.role === 'queen'
  return { Icon: isQueen ? ChessQueen : Pickaxe, roleLabel: isQueen ? 'Queen' : 'Worker' }
}

function lastSegment(path: string) {
  const withoutTrailingSlash = path.replace(/\/+$/, '')
  const index = withoutTrailingSlash.lastIndexOf('/')
  return index === -1 ? withoutTrailingSlash : withoutTrailingSlash.slice(index + 1)
}
