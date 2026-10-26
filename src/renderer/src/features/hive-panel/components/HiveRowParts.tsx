import { SessionId } from '@shared/types/brand'
import { IDLE_ROW_COLOR_VAR } from '@shared/types/session-status'
import { ChessQueen, Pickaxe } from 'lucide-react'
import { useState } from 'react'
import { useSessionStore } from '@/features/sessions/state'
import { SessionItemContextMenu } from '@/features/sidebar/components'
import { usePinnedSessionsStore } from '@/features/sidebar/state'
import { useUnarchiveSessionMutation } from '@/queries/archived-sessions'
import type { HiveSession } from '@/queries/session-hive-contract'
import { cn } from '@/shared/lib/cn'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { useHivePanelSessionActions } from '../hooks/useHivePanelSessionActions'
import { useHiveSessionState } from '../hooks/useHiveSessionState'

/**
 * The Hive rows are a three-column table (ADR 0051 review): Session, Workspace, State — with one
 * column header over the whole list, so the trailing cells read as columns rather than stray
 * words. The header and every row share this grid; the Session column takes the rest. Inline
 * rather than Tailwind classes because the dev Tailwind source snapshot only regenerates on a
 * dev-server restart, and the columns must be tunable without one.
 *
 * Rows reserve a right gutter (`pr-9`) for the ⋯ actions button, and the column header reserves
 * the same, so the right-aligned State column never runs under the button and nothing shifts when
 * the button appears on hover.
 */
export const HIVE_ROW_GRID_STYLE = {
  display: 'grid',
  // The State cell says who acts next and why (issue 380), and wraps the longer labels.
  gridTemplateColumns: 'minmax(0, 1fr) 72px 112px',
  columnGap: '8px',
} as const satisfies React.CSSProperties

export const HIVE_ROW_CLASS =
  'min-h-9 w-full items-center rounded-md py-1.5 pr-9 pl-2 text-left transition-colors group-hover:bg-bg-hover'

/** The row's ⋯ menu state and openers. */
export function useRowMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  return {
    open,
    pos,
    close: () => setOpen(false),
    openAtPointer(event: React.MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
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

export type HiveRowMenuState = ReturnType<typeof useRowMenu>

/** The row's role glyph and label, from the lineage role. */
function hiveRolePresentation(session: { readonly lineage?: { readonly role?: string } | null }) {
  const isQueen = session.lineage?.role === 'queen'
  return { Icon: isQueen ? ChessQueen : Pickaxe, label: isQueen ? 'Queen' : 'Worker' }
}

/** Everything a Hive row shows, from its Session and the live stores it subscribes to. */
export function useHiveRowView(session: HiveSession, isRoot: boolean) {
  const sessionId = SessionId(String(session.id))
  const { statusColor, state } = useHiveSessionState(session)
  const isPinned = usePinnedSessionsStore((store) =>
    store.pins.some((pin) => String(pin.sessionId) === String(sessionId)),
  )
  return {
    session,
    sessionId,
    isPinned,
    statusColor: statusColor ?? IDLE_ROW_COLOR_VAR,
    state,
    role: isRoot ? { Icon: ChessQueen, label: 'Queen' } : hiveRolePresentation(session),
    // projectName takes the last segment of either separator, so Windows paths shorten too.
    workspace: session.worktreePath ? projectName(session.worktreePath) : 'Checkout',
  }
}

export type HiveRowView = ReturnType<typeof useHiveRowView>

/**
 * The row's accessible name. It carries every cell, because a name set on the row replaces its
 * content for assistive technology: without the state and Workspace here, they would be silent.
 * The parent comes right after the title, in the words every surface uses (#377).
 */
export function hiveRowAccessibleName(
  view: HiveRowView,
  parentTitle: string | null,
  extras: readonly string[] = [],
) {
  const parts = [
    `Open ${view.role.label} Session: ${view.session.title}`,
    ...(parentTitle === null ? [] : [`spawned by ${parentTitle}`]),
    ...(view.isPinned ? ['pinned'] : []),
    `state ${view.state.label}`,
    `workspace ${view.workspace}`,
    ...extras,
  ]
  return parts.join(', ')
}

/** The role glyph, coloured when the row needs you, and the live status dot. */
export function HiveRowGlyphs({ view }: { readonly view: HiveRowView }) {
  const Icon = view.role.Icon
  return (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0',
          view.state.needsYou ? 'text-warning' : 'text-text-tertiary',
        )}
      />
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: view.statusColor }}
      />
    </>
  )
}

/** A title takes up to two lines, so Workers whose titles share a long start read apart (#356). */
export function HiveRowTitle({ view }: { readonly view: HiveRowView }) {
  return (
    <span
      className="line-clamp-2 break-words text-sm text-text-secondary"
      title={view.session.title}
    >
      {view.session.title}
    </span>
  )
}

export function HivePinnedBadge({ view }: { readonly view: HiveRowView }) {
  if (!view.isPinned) return null
  return (
    <span className="shrink-0 rounded border border-border-light bg-bg-tertiary px-1 py-0.5 text-xs text-text-tertiary">
      Pinned
    </span>
  )
}

export function HiveWorkspaceCell({ view }: { readonly view: HiveRowView }) {
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

export function HiveStateCell({ view }: { readonly view: HiveRowView }) {
  return (
    <span
      className={cn(
        'line-clamp-2 text-right text-xs',
        view.state.needsYou ? 'text-warning' : 'text-text-tertiary',
      )}
      title={view.state.hint}
    >
      {view.state.label}
    </span>
  )
}

/** The row's ⋯ menu, hidden until a Sidebar has registered the shared session actions. */
export function HiveRowMenu({
  view,
  menu,
  onRename,
  buttonClassName,
}: {
  readonly view: HiveRowView
  readonly menu: HiveRowMenuState
  readonly onRename: () => void
  /** Where the ⋯ button sits in its row; centred vertically by default. */
  readonly buttonClassName?: string
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
        className={cn(
          'absolute right-1.5 hidden size-6 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary group-hover:flex group-focus-within:flex',
          buttonClassName ?? 'top-1/2 -translate-y-1/2',
        )}
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
