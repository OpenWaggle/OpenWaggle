import { SessionId } from '@shared/types/brand'
import { IDLE_ROW_COLOR_VAR, resolveSessionStatusPill } from '@shared/types/session-status'
import { ChessQueen, Pickaxe } from 'lucide-react'
import { useState } from 'react'
import { SessionTitleInput, useSessionTitleRename } from '@/features/session-title'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { SessionItemContextMenu } from '@/features/sidebar/components'
import { usePinnedSessionsStore } from '@/features/sidebar/state'
import { useUnarchiveSessionMutation } from '@/queries/archived-sessions'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { useHivePanelSessionActions } from '../hooks/useHivePanelSessionActions'
import { type HiveTreeRow, hiveRowStateLabel } from '../lib/hive-tree-model'

/**
 * The Hive rows are a three-column table (ADR 0051 review): Session, Workspace, State — with one
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

const ROW_CLASS =
  'min-h-9 w-full items-center rounded-md py-1.5 pr-9 pl-2 text-left transition-colors group-hover:bg-bg-hover'

/** Everything a Hive row shows, from its Session and the live stores it subscribes to. */
function useHiveRowView(row: HiveTreeRow, isRoot: boolean) {
  const session = row.session
  const sessionId = SessionId(String(session.id))
  const status = useSessionStatusStore((store) => store.statuses.get(sessionId) ?? 'idle')
  const statusView = resolveSessionStatusPill(status)
  const isPinned = usePinnedSessionsStore((store) =>
    store.pins.some((pin) => String(pin.sessionId) === String(sessionId)),
  )
  return {
    session,
    sessionId,
    via: row.via,
    isPinned,
    statusColor: statusView?.colorVar ?? IDLE_ROW_COLOR_VAR,
    state: hiveRowStateLabel(session, statusView?.shortLabel ?? 'Idle'),
    role: isRoot ? { Icon: ChessQueen, label: 'Queen' } : hiveRolePresentation(session),
    workspace: session.worktreePath ? lastSegment(session.worktreePath) : 'Checkout',
  }
}

type HiveRowView = ReturnType<typeof useHiveRowView>

/**
 * The row's accessible name. It carries every cell, because a name set on the row replaces its
 * content for assistive technology: without the state and Workspace here, they would be silent.
 */
function hiveRowAccessibleName(view: HiveRowView) {
  const via = view.via === null ? '' : `, via ${view.via}`
  const pinned = view.isPinned ? ', pinned' : ''
  return `Open ${view.role.label} Session: ${view.session.title}${via}${pinned}, state ${view.state.label}, workspace ${view.workspace}`
}

/**
 * One Hive panel row: state, Workspace placement, and the sidebar's own ⋯ menu (ADR 0051).
 *
 * The menu is the same `SessionItemContextMenu` the sidebar renders, registered by the Sidebar,
 * so every action behaves identically in both places. Rename edits the title in place, as in the
 * sidebar; an archived row offers Unarchive instead of Archive, and Move up / Move down stay
 * Pinned-only.
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
  const view = useHiveRowView(row, isRoot)
  const menu = useRowMenu()
  const rename = useSessionTitleRename(view.sessionId, view.session.title)

  return (
    <div className="group relative">
      {rename.isEditing ? (
        // An input cannot live inside the row's button, so the editing row is a plain grid.
        <div className={ROW_CLASS} style={HIVE_ROW_GRID_STYLE}>
          <span className="flex min-w-0 items-center">
            <SessionTitleInput rename={rename} className="text-sm" />
          </span>
          <HiveWorkspaceCell view={view} />
          <HiveStateCell view={view} />
        </div>
      ) : (
        <Button
          ref={rename.returnFocusRef}
          type="button"
          variant="unstyled"
          className={ROW_CLASS}
          style={HIVE_ROW_GRID_STYLE}
          aria-current={isCurrent ? 'true' : undefined}
          aria-label={hiveRowAccessibleName(view)}
          onClick={onOpen}
          onContextMenu={menu.openAtPointer}
        >
          <HiveSessionCell view={view} />
          <HiveWorkspaceCell view={view} />
          <HiveStateCell view={view} />
        </Button>
      )}
      {/* No row actions while renaming: the input owns the row, as in the sidebar. */}
      {rename.isEditing ? null : <HiveRowMenu view={view} menu={menu} onRename={rename.start} />}
    </div>
  )
}

function HiveSessionCell({ view }: { readonly view: HiveRowView }) {
  const Icon = view.role.Icon
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon
        aria-hidden="true"
        className={
          view.state.needsAttention
            ? 'size-3.5 shrink-0 text-warning'
            : 'size-3.5 shrink-0 text-text-tertiary'
        }
      />
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: view.statusColor }}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
        {view.session.title}
        {view.via !== null ? <span className="text-text-tertiary"> · via {view.via}</span> : null}
      </span>
      {view.isPinned ? (
        <span className="shrink-0 rounded border border-border-light bg-bg-tertiary px-1 py-0.5 text-xs text-text-tertiary">
          Pinned
        </span>
      ) : null}
    </span>
  )
}

function HiveWorkspaceCell({ view }: { readonly view: HiveRowView }) {
  return (
    <span
      className="truncate text-right text-xs text-text-tertiary"
      title={
        view.session.worktreePath
          ? `Workspace: ${view.session.worktreePath}`
          : 'Workspace: the project checkout'
      }
    >
      {view.workspace}
    </span>
  )
}

function HiveStateCell({ view }: { readonly view: HiveRowView }) {
  return (
    <span
      className={
        view.state.needsAttention
          ? 'truncate text-right text-xs text-warning'
          : 'truncate text-right text-xs text-text-tertiary'
      }
      title={view.state.hint}
    >
      {view.state.short}
    </span>
  )
}

/** The row's ⋯ menu, hidden until a Sidebar has registered the shared session actions. */
function HiveRowMenu({
  view,
  menu,
  onRename,
}: {
  readonly view: HiveRowView
  readonly menu: ReturnType<typeof useRowMenu>
  readonly onRename: () => void
}) {
  const actions = useHivePanelSessionActions()
  const unarchive = useUnarchiveSessionMutation()
  const showToast = useUIStore((state) => state.showToast)
  if (actions === null) return null
  const { sessionId, session } = view

  function unarchiveSession() {
    menu.close()
    void unarchive
      .mutateAsync(sessionId)
      .then(() => useSessionStore.getState().loadSessions())
      .catch((error: unknown) => {
        // The row stays archived and keeps offering Unarchive; say why it did not move.
        const reason = error instanceof Error ? error.message : String(error)
        showToast(`Unable to unarchive ${session.title}: ${reason}`, 'error')
      })
  }
  return (
    <>
      <Button
        type="button"
        variant="unstyled"
        aria-label={`Open session actions for ${session.title}`}
        onClick={menu.openUnderButton}
        className="absolute top-1/2 right-1.5 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary group-hover:flex group-focus-within:flex"
      >
        ⋯
      </Button>
      <SessionItemContextMenu
        open={menu.open}
        position={menu.pos}
        sessionId={sessionId}
        isPinned={view.isPinned}
        actions={actions}
        archived={session.archived === true}
        commands={{ rename: onRename, moveUp: null, moveDown: null, restore: unarchiveSession }}
        onClose={menu.close}
      />
    </>
  )
}

/** The row's role glyph and label, from the lineage role. */
function hiveRolePresentation(session: { readonly lineage?: { readonly role?: string } | null }) {
  const isQueen = session.lineage?.role === 'queen'
  return { Icon: isQueen ? ChessQueen : Pickaxe, label: isQueen ? 'Queen' : 'Worker' }
}

function lastSegment(path: string) {
  const withoutTrailingSlash = path.replace(/\/+$/, '')
  const index = withoutTrailingSlash.lastIndexOf('/')
  return index === -1 ? withoutTrailingSlash : withoutTrailingSlash.slice(index + 1)
}
