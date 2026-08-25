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
import { SessionListItem } from './SessionListItem'
import { SidebarIconButton, SidebarSectionHead } from './SidebarSectionHead'

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
  readonly sort: PinnedSortControlState
  readonly displayProjectName: (path: string) => string
  readonly sessionActions: SidebarSessionActions
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
  sort,
  displayProjectName,
  sessionActions,
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
            place={{ index: renderIndex, count: rows.length }}
            draggable={draggable}
            isActive={activeSessionId === String(row.session.id)}
            projectLabel={
              showProjectLabel && row.session.projectPath
                ? displayProjectName(row.session.projectPath)
                : ''
            }
            sessionActions={sessionActions}
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
function PinnedSessionListItem({
  row,
  place,
  draggable,
  isActive,
  projectLabel,
  sessionActions,
  onReorder,
}: {
  readonly row: PinnedSessionRow
  /** Where the row sits among the rendered rows, and how many there are. */
  readonly place: { readonly index: number; readonly count: number }
  readonly draggable: boolean
  readonly isActive: boolean
  readonly projectLabel: string
  readonly sessionActions: SidebarSessionActions
  readonly onReorder: (sessionId: SessionId, targetIndex: number) => void
}) {
  const sessionId = SessionId(String(row.session.id))
  /*
   * Manual order only. In a sorted order the position is derived, so moving a row would either be
   * undone by the sort or silently switch the whole section to Manual.
   */
  const canMoveUp = draggable && place.index > 0
  const canMoveDown = draggable && place.index < place.count - 1

  return (
    <SessionListItem
      session={row.session}
      isActive={isActive}
      actions={sessionActions}
      isPinned
      pinnedRow={{
        projectLabel,
        // The row's position in the whole section, not its position among the rendered rows.
        shortcutIndex: row.position < PINNED_SHORTCUT_LIMIT ? row.position : null,
        draggable,
        onMoveUp: canMoveUp ? () => onReorder(sessionId, place.index - 1) : null,
        onMoveDown: canMoveDown ? () => onReorder(sessionId, place.index + 1) : null,
      }}
      rowProps={{
        draggable,
        'data-pinned-index': place.index,
        'data-pinned-session-id': String(row.session.id),
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', String(row.session.id))
          event.currentTarget.dataset.dragging = 'true'
        },
        onDragEnd: (event) => {
          delete event.currentTarget.dataset.dragging
          event.currentTarget.removeAttribute('data-drop-target')
        },
        onDragOver: (event) => {
          if (!draggable) return
          event.preventDefault()
          event.currentTarget.dataset.dropTarget = 'true'
        },
        onDragLeave: (event) => {
          event.currentTarget.removeAttribute('data-drop-target')
        },
        onDrop: (event) => {
          event.preventDefault()
          event.currentTarget.removeAttribute('data-drop-target')
          const draggedSessionId = event.dataTransfer.getData('text/plain')
          if (!draggedSessionId || draggedSessionId === String(row.session.id)) return
          onReorder(SessionId(draggedSessionId), place.index)
        },
        className: cn(
          'transition-opacity',
          draggable && 'data-[dragging=true]:opacity-40',
          'data-[drop-target=true]:shadow-[inset_0_2px_0_var(--color-accent)]',
        ),
      }}
    />
  )
}
