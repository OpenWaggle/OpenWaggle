import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'

/** The drag payload type a queued-message handle carries, so unrelated drops are ignored. */
export const QUEUED_MESSAGE_DRAG_TYPE = 'application/x-openwaggle-follow-up'

interface QueuedMessageReorderHandleProps {
  readonly followUpId: string
  /** What the handle reorders, for its accessible name. */
  readonly label: string
  readonly onMoveUp: (() => void) | null
  readonly onMoveDown: (() => void) | null
  readonly onDragStart: () => void
  readonly onDragEnd: () => void
}

/**
 * Drag handle and keyboard route for Follow-up reordering.
 *
 * Dragging the grip is the pointer route. Dragging alone fails WCAG 2.2 SC 2.1.1 Keyboard and
 * SC 2.5.7 Dragging Movements, so activating the same grip opens a menu with Move up / Move
 * down, as the Pinned sidebar section does through its row menu.
 */
export function QueuedMessageReorderHandle({
  followUpId,
  label,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
}: QueuedMessageReorderHandleProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  function moveAndClose(move: () => void) {
    setMenuOpen(false)
    move()
  }

  return (
    <Popover
      open={menuOpen}
      onOpenChange={setMenuOpen}
      placement="bottom-start"
      className="min-w-32 py-1"
      role="menu"
      trigger={
        <Button
          variant="unstyled"
          type="button"
          draggable
          data-qa="queued-message-grip"
          aria-label={`Reorder ${label}`}
          title="Drag to reorder, or click to move"
          onClick={() => setMenuOpen(!menuOpen)}
          onDragStart={(event) => {
            setMenuOpen(false)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData(QUEUED_MESSAGE_DRAG_TYPE, followUpId)
            onDragStart()
          }}
          onDragEnd={onDragEnd}
          className="flex h-5 w-3.5 cursor-grab items-center justify-center rounded text-text-tertiary hover:text-text-secondary active:cursor-grabbing"
        >
          <GripVertical className="size-3" />
        </Button>
      }
    >
      {onMoveUp ? (
        <Button
          variant="row"
          size="xs"
          radius="none"
          role="menuitem"
          onClick={() => moveAndClose(onMoveUp)}
          className="gap-2 px-3 text-xs"
        >
          <ArrowUp className="size-3 shrink-0" />
          Move up
        </Button>
      ) : null}
      {onMoveDown ? (
        <Button
          variant="row"
          size="xs"
          radius="none"
          role="menuitem"
          onClick={() => moveAndClose(onMoveDown)}
          className="gap-2 px-3 text-xs"
        >
          <ArrowDown className="size-3 shrink-0" />
          Move down
        </Button>
      ) : null}
    </Popover>
  )
}
