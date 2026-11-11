import { SessionId } from '@shared/types/brand'
import { IDLE_ROW_COLOR_VAR } from '@shared/types/session-status'
import { Bot, ChessQueen, Pickaxe } from 'lucide-react'
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
import {
  agentAccessibleName,
  agentIdentityTitle,
  hiveAgentPresentation,
} from '../lib/hive-agent-presentation'

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
  // The State cell says who acts next and why (issue 380); it wraps, never truncates, because a
  // label such as "Run failed, ‹parent› notified" names the parent and must be read whole.
  gridTemplateColumns: 'minmax(0, 1fr) 72px 104px',
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
    openAtPointer: (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setPos({ x: event.clientX, y: event.clientY })
      setOpen(true)
    },
    openUnderButton: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      setPos({ x: rect.left, y: rect.bottom })
      setOpen(true)
    },
  }
}

export type HiveRowMenuState = ReturnType<typeof useRowMenu>

/** The row's role glyph and label, from the lineage role. */
function hiveRolePresentation(session: {
  readonly lineage?: { readonly role?: string | undefined } | null | undefined
}) {
  const isQueen = session.lineage?.role === 'queen'
  return { Icon: isQueen ? ChessQueen : Pickaxe, label: isQueen ? 'Queen' : 'Worker' }
}

/** Everything a Hive row shows, from its Session and the live stores it subscribes to. */
export function useHiveRowView(session: HiveSession, isRoot: boolean) {
  const sessionId = SessionId(String(session.id))
  const { statusColor, state } = useHiveSessionState(session)
  const agent = hiveAgentPresentation(session)
  const isPinned = usePinnedSessionsStore((store) =>
    store.pins.some((pin) => String(pin.sessionId) === String(sessionId)),
  )
  return {
    session,
    sessionId,
    isPinned,
    statusColor: statusColor ?? IDLE_ROW_COLOR_VAR,
    state,
    agent,
    role: isRoot ? { Icon: ChessQueen, label: 'Queen' } : hiveRolePresentation(session),
    // projectName takes the last segment of either separator, so Windows paths shorten too.
    workspace: session.worktreePath ? projectName(session.worktreePath) : 'Checkout',
  }
}

export type HiveRowView = ReturnType<typeof useHiveRowView>

/**
 * The row's accessible name. It carries every cell, because a name set on the row replaces its
 * content for assistive technology: without the state and Workspace here, they would be silent.
 * The parent comes right after the title, in the words every surface uses (#377), and the Agent
 * definition identity after it.
 */
export function hiveRowAccessibleName(
  view: HiveRowView,
  parentTitle: string | null,
  extras: readonly string[] = [],
) {
  const parts = [
    `Open ${view.role.label} Session: ${view.session.title}`,
    ...(parentTitle === null ? [] : [`spawned by ${parentTitle}`]),
    ...(view.agent ? [agentAccessibleName(view.agent)] : []),
    ...(view.isPinned ? ['pinned'] : []),
    `state ${view.state.label}`,
    `workspace ${view.workspace}`,
    ...extras,
  ]
  return parts.join(', ')
}

/**
 * The role glyph, coloured when the row needs you, and the live status dot. A Worker created from
 * an Agent definition shows the agent glyph in the agent colour instead of the pickaxe.
 */
export function HiveRowGlyphs({ view }: { readonly view: HiveRowView }) {
  const agentWorker = view.agent !== null && view.role.label === 'Worker'
  const Icon = agentWorker ? Bot : view.role.Icon
  return (
    <>
      <Icon
        aria-hidden="true"
        data-agent-glyph={agentWorker ? 'true' : undefined}
        className={cn(
          'size-3.5 shrink-0',
          view.state.needsYou
            ? 'text-warning'
            : agentWorker
              ? 'text-info-text'
              : 'text-text-tertiary',
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

/**
 * "reviewer · High · GLM-5.3-Flash" under the title of a Session created from an Agent
 * definition: which definition it runs, and what it runs with. Visual only: the row's
 * accessible name carries the same three parts.
 */
export function HiveAgentIdentity({ view }: { readonly view: HiveRowView }) {
  const agent = view.agent
  if (agent === null) return null
  const details = [agent.thinkingLine, agent.model].filter((part): part is string => part !== null)
  return (
    <span
      aria-hidden="true"
      data-hive-agent={agent.name}
      className="block truncate text-xs text-text-tertiary"
      title={agentIdentityTitle(agent)}
    >
      <span className="text-info-text">{agent.name}</span>
      {details.map((part) => (
        <span key={part}> · {part}</span>
      ))}
    </span>
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
        'break-words text-right text-xs',
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
