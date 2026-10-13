import { SessionId } from '@shared/types/brand'
import { ArrowDownAZ, Calendar, Check, Clock, GripVertical, LayoutList } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import {
  PINNED_SHORTCUT_LIMIT,
  type PinnedSessionRow,
  type PinnedSortMode,
} from '../lib/pinned-sessions'
import type { SidebarSessionActions } from '../model'
import { SessionListItem, type SessionRowHighlight } from './SessionListItem'
import { SidebarIconButton, SidebarSectionHead } from './SidebarSectionHead'

const PINNED_SESSION_DRAG_TYPE = 'application/x-openwaggle-pinned-session'

/**
 * Pinned sort options. Deliberately the same labels, icons and popover treatment as the
 * Projects sort control, with `Manual` — the user's dragged order — added as the default.
 */
const PINNED_SORT_OPTIONS: {
  value: PinnedSortMode
  label: string
  icon: typeof Clock
}[] = [
  { value: 'manual', label: 'Manual', icon: GripVertical },
  { value: 'recent', label: 'Recent', icon: Clock },
  { value: 'oldest', label: 'Oldest', icon: Calendar },
  { value: 'name', label: 'Name (A->Z)', icon: ArrowDownAZ },
]

/** The Pinned sort and its menu state, grouped so the section stays a small surface. */
export interface PinnedSortControlState {
  readonly mode: PinnedSortMode
  readonly menuOpen: boolean
  readonly onSetMenuOpen: (open: boolean) => void
  readonly onSetMode: (mode: PinnedSortMode) => void
  /**
   * Whether the section can be reordered at all right now.
   *
   * False while a chip or the text filter is narrowing the list. Reordering is expressed as
   * "between these two rows", and with rows hidden the two rows on screen are not the two rows
   * in the list: moving a pin down past the only other visible pin would silently jump every
   * hidden pin above it. Positions are already computed over the unfiltered section for the same
   * reason, and a filtered view is not the real list.
   */
  readonly reorderable: boolean
}

interface SidebarPinnedSectionProps {
  readonly rows: readonly PinnedSessionRow[]
  readonly activeSessionId: string | null
  /** The Queen of the Hive the open Worker belongs to, for her secondary row highlight. */
  readonly activeHiveRootId: string | null
  readonly sort: PinnedSortControlState
  readonly displayProjectName: (path: string) => string
  readonly sessionActions: SidebarSessionActions
  /** Per-Queen hidden-Worker attention, shown on Queen rows' second line (ADR 0050). */
  readonly workerAttentionOf: (queenId: string) => number
  readonly onReorder: (sessionId: SessionId, targetIndex: number) => void
}

function PinnedSortMenu({ sort }: { readonly sort: PinnedSortControlState }) {
  const { mode: sortMode, menuOpen: sortMenuOpen, onSetMenuOpen, onSetMode } = sort
  return (
    <Popover
      open={sortMenuOpen}
      onOpenChange={onSetMenuOpen}
      placement="bottom-end"
      className="min-w-49 py-1"
      role="menu"
      trigger={
        <SidebarIconButton
          label="Sort pinned sessions"
          isActive={sortMenuOpen}
          onClick={() => onSetMenuOpen(!sortMenuOpen)}
        >
          <LayoutList className="size-3.5" />
        </SidebarIconButton>
      }
    >
      {PINNED_SORT_OPTIONS.map((option) => (
        <Button
          variant="row"
          size="xs"
          radius="none"
          key={option.value}
          role="menuitemradio"
          aria-checked={sortMode === option.value}
          onClick={() => {
            onSetMode(option.value)
            onSetMenuOpen(false)
          }}
          className={cn('gap-2 px-3 text-xs', sortMode === option.value && 'text-accent')}
        >
          <option.icon className="size-3 shrink-0" />
          <span className="flex-1">{option.label}</span>
          {sortMode === option.value ? <Check className="size-3 shrink-0" /> : null}
        </Button>
      ))}
    </Popover>
  )
}

/**
 * The Pinned section: every Pinned session, in the active Pinned sort, above the project
 * list. Rendered only when something is pinned, so an unused feature costs no space.
 *
 * Reordering is drag-and-drop and only offered in Manual order — the derived sorts are
 * computed from session data, so dragging within them would have nothing to write.
 */
export function SidebarPinnedSection({
  rows,
  activeSessionId,
  activeHiveRootId,
  sort,
  displayProjectName,
  sessionActions,
  workerAttentionOf,
  onReorder,
}: SidebarPinnedSectionProps) {
  if (rows.length === 0) return null

  const draggable = sort.mode === 'manual' && sort.reorderable
  /*
   * The project label only earns its width when the pinned rows span more than one
   * project. With every pin in the same project it is pure noise, and at a 272px sidebar
   * it costs ~46px that the session title needs.
   */
  const projectPaths = new Set(rows.map((row) => row.session.projectPath ?? ''))
  const showProjectLabel = projectPaths.size > 1

  return (
    <section aria-label="Pinned sessions" className="shrink-0">
      <SidebarSectionHead label="Pinned" count={rows.length}>
        <PinnedSortMenu sort={sort} />
      </SidebarSectionHead>
      <ul>
        {rows.map((row, renderIndex) => (
          <PinnedSessionListItem
            key={String(row.session.id)}
            row={row}
            place={{ index: renderIndex, count: rows.length, draggable }}
            highlight={pinnedRowHighlight({
              activeSessionId,
              activeHiveRootId,
              sessionId: String(row.session.id),
            })}
            projectLabel={
              showProjectLabel && row.session.projectPath
                ? displayProjectName(row.session.projectPath)
                : ''
            }
            sessionActions={sessionActions}
            workerAttentionCount={workerAttentionOf(String(row.session.id))}
            onReorder={onReorder}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * One Pinned row.
 *
 * Drag feedback is applied to the DOM node directly rather than through state, because
 * re-rendering the dragged row mid-gesture cancels the drag and does so silently. Only
 * the drop commits anything.
 */
/** How one Pinned row is emphasized: the open Session, its Queen's Hive home, or neither. */
function pinnedRowHighlight(input: {
  readonly activeSessionId: string | null
  readonly activeHiveRootId: string | null
  readonly sessionId: string
}): SessionRowHighlight {
  if (input.activeSessionId === input.sessionId) return 'active'
  if (input.activeHiveRootId !== null && input.activeHiveRootId === input.sessionId) {
    return 'hive-home'
  }
  return 'none'
}

function PinnedSessionListItem({
  row,
  place,
  highlight,
  projectLabel,
  sessionActions,
  workerAttentionCount,
  onReorder,
}: {
  readonly row: PinnedSessionRow
  /** Where the row sits among the rendered rows, how many there are, and whether it drags. */
  readonly place: { readonly index: number; readonly count: number; readonly draggable: boolean }
  readonly highlight: SessionRowHighlight
  readonly projectLabel: string
  readonly sessionActions: SidebarSessionActions
  /** How many of this Queen's hidden Workers need the user (ADR 0050). */
  readonly workerAttentionCount: number
  readonly onReorder: (sessionId: SessionId, targetIndex: number) => void
}) {
  const sessionId = SessionId(String(row.session.id))
  /*
   * Manual order only. In a sorted order the position is derived, so moving a row would either be
   * undone by the sort or silently switch the whole section to Manual.
   */
  const canMoveUp = place.draggable && place.index > 0
  const canMoveDown = place.draggable && place.index < place.count - 1

  return (
    <SessionListItem
      session={row.session}
      highlight={highlight}
      actions={sessionActions}
      isPinned
      workerAttentionCount={workerAttentionCount}
      pinnedRow={{
        projectLabel,
        // The row's position in the whole section, not its position among the rendered rows.
        shortcutIndex: row.position < PINNED_SHORTCUT_LIMIT ? row.position : null,
        draggable: place.draggable,
        onMoveUp: canMoveUp ? () => onReorder(sessionId, place.index - 1) : null,
        onMoveDown: canMoveDown ? () => onReorder(sessionId, place.index + 1) : null,
      }}
      rowProps={{
        draggable: place.draggable,
        'data-pinned-index': place.index,
        'data-pinned-session-id': String(row.session.id),
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'move'
          // A custom type, so dragging selected text (say, out of the rename field) is never read
          // as a row move: only a row drag carries it.
          event.dataTransfer.setData(PINNED_SESSION_DRAG_TYPE, String(row.session.id))
          event.currentTarget.dataset.dragging = 'true'
        },
        onDragEnd: (event) => {
          delete event.currentTarget.dataset.dragging
          event.currentTarget.removeAttribute('data-drop-target')
        },
        onDragOver: (event) => {
          if (!place.draggable) return
          event.preventDefault()
          event.currentTarget.dataset.dropTarget = 'true'
        },
        onDragLeave: (event) => {
          event.currentTarget.removeAttribute('data-drop-target')
        },
        onDrop: (event) => {
          event.preventDefault()
          event.currentTarget.removeAttribute('data-drop-target')
          const draggedSessionId = event.dataTransfer.getData(PINNED_SESSION_DRAG_TYPE)
          if (!draggedSessionId || draggedSessionId === String(row.session.id)) return
          onReorder(SessionId(draggedSessionId), place.index)
        },
        className: cn(
          'transition-opacity',
          place.draggable && 'data-[dragging=true]:opacity-40',
          'data-[drop-target=true]:shadow-[inset_0_2px_0_var(--color-accent)]',
        ),
      }}
    />
  )
}
