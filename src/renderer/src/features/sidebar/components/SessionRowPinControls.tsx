import type { SessionSummary } from '@shared/types/session'
import { GripVertical, Pin, PinOff } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

/**
 * Pinned-session affordances for a sidebar session row (issue #97), kept out of
 * SessionListItem so that file stays within its size budget.
 */

/** Extras carried only by a row rendered inside the Pinned section. */
export interface SessionPinnedRowState {
  /**
   * The project this session belongs to, shown because the row sits outside its group.
   * Empty when every pinned row shares one project, where the label adds no information.
   */
  readonly projectLabel: string
  /** Zero-based Pinned shortcut position, or null when the row is past the ninth. */
  readonly shortcutIndex: number | null
  /** True in Manual order, where the row is a drag source and shows a grip. */
  readonly draggable: boolean
  /**
   * Keyboard route for reordering, null where the move is impossible or unavailable.
   *
   * Dragging is the only pointer route, and dragging alone fails WCAG 2.2 SC 2.1.1 Keyboard and
   * SC 2.5.7 Dragging Movements. These land in the row's context menu, which opens from the
   * keyboard, so reordering does not depend on a sustained pointer gesture.
   */
  readonly onMoveUp: (() => void) | null
  readonly onMoveDown: (() => void) | null
}

/**
 * Pin toggle on a session row. Revealed on hover like the actions trigger, and kept
 * visible while pinned so a Pinned row reads as pinned at a glance.
 */
export function SessionPinButton({
  isPinned,
  session,
  onClick,
}: {
  readonly isPinned: boolean
  readonly session: SessionSummary
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const Icon = isPinned ? PinOff : Pin
  return (
    <Button
      variant="unstyled"
      type="button"
      aria-label={`${isPinned ? 'Unpin' : 'Pin'} session ${session.title}`}
      title={isPinned ? 'Unpin session' : 'Pin session'}
      onClick={onClick}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-[background-color,color,opacity] hover:bg-bg-hover group-hover:opacity-100 focus:opacity-100',
        isPinned ? 'text-accent' : 'text-text-tertiary hover:text-text-secondary',
      )}
    >
      <Icon className="size-3" />
    </Button>
  )
}

/**
 * Fixed-width leading slot for a Pinned row's drag handle.
 *
 * Rendered in every Pinned sort, not only Manual: when the slot appeared and disappeared
 * with draggability, switching sort shifted every row sideways. The handle is visible at rest,
 * as in the prototype, because it is what tells the user a row can be dragged before they
 * touch it. It is absent outside Manual, where a drag would have nothing to write.
 */
export function SessionDragGripSlot({ draggable }: { readonly draggable: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid h-[17px] w-3.5 flex-none place-items-center text-text-tertiary"
    >
      {draggable ? <GripVertical className="size-3" /> : null}
    </span>
  )
}
